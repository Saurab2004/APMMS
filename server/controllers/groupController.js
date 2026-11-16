import mongoose from 'mongoose';
import { ProjectGroup, GroupInvitation, Project, User } from '../models/index.js';
import { batchAndTermFor } from '../services/batches.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler, ok, parsePage, pageMeta, escapeRegex, isId, generateGroupCode, idStr, sameId, addDays } from '../utils/helpers.js';
import { audit } from '../services/audit.js';
import { notify } from '../services/notifications.js';
import { getSettings } from '../services/settings.js';

const MEMBER_POPULATE = { path: 'members.user', select: 'name email studentId' };
const EDITABLE_PROJECT_STATES = ['forming', 'proposal', 'active'];

const findActiveGroupOf = (userId) =>
  ProjectGroup.findOne({ status: 'active', activeMemberIds: userId });

async function expireOldInvitations() {
  await GroupInvitation.updateMany({ status: 'pending', expiresAt: { $lte: new Date() } }, { $set: { status: 'expired' } });
}

async function assertCapacity(group, extra = 1) {
  const settings = await getSettings();
  const active = group.activeMembers().length;
  if (active + extra > settings.maxGroupSize) {
    throw new AppError(`This group is full (maximum ${settings.maxGroupSize} members)`, 409);
  }
}

async function assertNotInActiveGroup(userId, message) {
  const settings = await getSettings();
  if (!settings.singleActiveGroup) return;
  const existing = await findActiveGroupOf(userId);
  if (existing) throw new AppError(message || `Already a member of the active group "${existing.name}"`, 409);
}

async function loadGroup(id) {
  if (!isId(id)) throw new AppError('Group not found', 404);
  const group = await ProjectGroup.findById(id);
  if (!group) throw new AppError('Group not found', 404);
  return group;
}

function requireLeaderOf(group, user) {
  const m = group.activeMember(user._id);
  if (!m || m.role !== 'leader') throw new AppError('Only the Group Leader can do this', 403);
}

async function assertProjectEditable(group) {
  const project = await Project.findById(group.project);
  if (project && !EDITABLE_PROJECT_STATES.includes(project.status)) {
    throw new AppError('Group membership is locked after the final report has been submitted. Ask the coordinator for help.', 409);
  }
}

const shapeGroup = async (group) => {
  await group.populate([MEMBER_POPULATE, { path: 'term', select: 'name' }, { path: 'batch', select: 'name' }, { path: 'department', select: 'name code' }]);
  const project = await Project.findById(group.project).populate('supervisor', 'name email').lean();
  return { group: group.toJSON(), project };
};

// ---------------- Student views ----------------
export const getMyGroups = asyncHandler(async (req, res) => {
  await expireOldInvitations();
  const uid = req.user._id;
  const current = await findActiveGroupOf(uid);

  const pastDocs = await ProjectGroup.find({
    _id: { $ne: current?._id },
    'members.user': uid,
  })
    .populate('term', 'name')
    .populate('project', 'title status')
    .sort({ updatedAt: -1 })
    .lean();
  const past = pastDocs.map((g) => {
    const mine = g.members.find((m) => idStr(m.user) === idStr(uid));
    return { _id: g._id, name: g.name, code: g.code, status: g.status, term: g.term, project: g.project, myRole: mine?.role, myStatus: mine?.status, joinedAt: mine?.joinedAt, leftAt: mine?.leftAt };
  });

  const incoming = await GroupInvitation.find({ invitedUser: uid, status: 'pending' })
    .populate({ path: 'group', select: 'name code' })
    .populate('invitedBy', 'name')
    .sort({ createdAt: -1 })
    .lean();

  let currentData = null;
  let outgoing = [];
  if (current) {
    currentData = await shapeGroup(current);
    currentData.myRole = current.activeMember(uid).role;
    if (currentData.myRole === 'leader') {
      outgoing = await GroupInvitation.find({ group: current._id, status: 'pending' }).populate('invitedUser', 'name email').lean();
    }
  }
  ok(res, { current: currentData, outgoingInvitations: outgoing, incomingInvitations: incoming, past });
});

export const createGroup = asyncHandler(async (req, res) => {
  if (!req.user.department) throw new AppError('Your account has no department. Please contact the coordinator.', 409);
  await assertNotInActiveGroup(req.user._id, 'You are already in an active group. Leave it first to create a new one.');
  const { batch, term } = await batchAndTermFor(req.user);

  const name = req.body.name;
  let group = null;
  for (let attempt = 0; attempt < 6 && !group; attempt += 1) {
    try {
      group = await ProjectGroup.create({
        name,
        nameKey: name.toLowerCase(),
        code: generateGroupCode(),
        term: term._id,
        batch: batch?._id,
        department: req.user.department,
        createdBy: req.user._id,
        members: [{ user: req.user._id, role: 'leader' }],
      });
    } catch (err) {
      if (err.code === 11000 && err.keyPattern?.code) continue; // code clash: try another
      if (err.code === 11000) throw new AppError('A group with this name already exists this term', 409, { name: 'Already taken' });
      throw err;
    }
  }
  if (!group) throw new AppError('Could not generate a unique group code, please try again', 500);

  try {
    const project = await Project.create({ group: group._id, term: term._id, batch: batch?._id, department: req.user.department });
    group.project = project._id;
    await group.save();
  } catch (err) {
    await ProjectGroup.deleteOne({ _id: group._id });
    throw err;
  }
  await audit(req, { action: 'group.created', entityType: 'ProjectGroup', entityId: group._id, project: group.project, scope: 'project', summary: `Group "${group.name}" created` });
  ok(res, await shapeGroup(group), 201);
});

export const joinByCode = asyncHandler(async (req, res) => {
  const code = String(req.body.code).toUpperCase();
  const group = await ProjectGroup.findOne({ code, status: 'active' });
  if (!group) throw new AppError('No active group matches that code', 404, { code: 'Invalid code' });
  if (idStr(group.department) !== idStr(req.user.department)) throw new AppError('This group belongs to a different department', 403);
  if (group.batch && idStr(group.batch) !== idStr(req.user.batch)) throw new AppError('This group belongs to a different batch', 403);
  if (group.activeMember(req.user._id)) throw new AppError('You are already a member of this group', 409);
  await assertNotInActiveGroup(req.user._id, 'You are already in an active group. Leave it before joining another.');
  await assertProjectEditable(group);
  await assertCapacity(group);

  const previous = group.members.find((m) => idStr(m.user) === idStr(req.user._id));
  if (previous) Object.assign(previous, { status: 'active', role: 'member', joinedAt: new Date(), leftAt: undefined });
  else group.members.push({ user: req.user._id, role: 'member' });
  await group.save();

  await GroupInvitation.updateMany({ invitedUser: req.user._id, status: 'pending' }, { $set: { status: 'cancelled' } });
  const leader = group.leader();
  await notify([leader?.user], { type: 'group_joined', title: 'New member joined your group', body: `${req.user.name} joined "${group.name}" using the group code.`, link: '/student/group' });
  await audit(req, { action: 'group.member_joined', entityType: 'ProjectGroup', entityId: group._id, project: group.project, scope: 'project', summary: `${req.user.name} joined the group` });
  ok(res, await shapeGroup(group));
});

export const inviteMember = asyncHandler(async (req, res) => {
  const group = await loadGroup(req.params.id);
  requireLeaderOf(group, req.user);
  if (group.status !== 'active') throw new AppError('This group is not active', 409);
  await expireOldInvitations();
  await assertProjectEditable(group);
  const settings = await getSettings();

  const invitee = await User.findOne({ email: req.body.email, role: 'student', isActive: true });
  if (!invitee) throw new AppError('No active student with this email was found', 404, { email: 'Student not found' });
  if (idStr(invitee.department) !== idStr(group.department)) throw new AppError('This student belongs to a different department', 409, { email: 'Different department' });
  if (group.batch && idStr(invitee.batch) !== idStr(group.batch)) throw new AppError('This student belongs to a different batch', 409, { email: 'Different batch' });
  if (group.activeMember(invitee._id)) throw new AppError('This student is already in your group', 409);
  if (settings.singleActiveGroup && (await findActiveGroupOf(invitee._id))) throw new AppError('This student is already in another active group', 409, { email: 'Already in a group' });

  const pending = await GroupInvitation.countDocuments({ group: group._id, status: 'pending' });
  if (group.activeMembers().length + pending + 1 > settings.maxGroupSize) {
    throw new AppError(`Active members plus pending invitations would exceed the group limit of ${settings.maxGroupSize}`, 409);
  }
  let invitation;
  try {
    invitation = await GroupInvitation.create({
      group: group._id,
      invitedUser: invitee._id,
      invitedBy: req.user._id,
      expiresAt: addDays(new Date(), settings.invitationExpiryDays),
    });
  } catch (err) {
    if (err.code === 11000) throw new AppError('This student already has a pending invitation to your group', 409);
    throw err;
  }
  await notify([invitee._id], {
    type: 'group_invitation',
    title: `Invitation to join "${group.name}"`,
    body: `${req.user.name} invited you to join their project group.`,
    link: '/student/invitations',
    dedupeKey: `invite:${invitation._id}`,
  });
  await audit(req, { action: 'group.invited', entityType: 'GroupInvitation', entityId: invitation._id, project: group.project, scope: 'project', summary: `Invited ${invitee.name}` });
  ok(res, invitation, 201);
});

export const respondToInvitation = asyncHandler(async (req, res) => {
  if (!isId(req.params.id)) throw new AppError('Invitation not found', 404);
  await expireOldInvitations();
  const invitation = await GroupInvitation.findOne({ _id: req.params.id, invitedUser: req.user._id });
  if (!invitation) throw new AppError('Invitation not found', 404);
  if (invitation.status !== 'pending') throw new AppError(`This invitation is no longer open (${invitation.status})`, 409);

  const group = await ProjectGroup.findById(invitation.group);
  if (!group || group.status !== 'active') {
    invitation.status = 'cancelled';
    await invitation.save();
    throw new AppError('This group no longer exists', 409);
  }
  const leader = group.leader();

  if (!req.body.accept) {
    invitation.status = 'rejected';
    invitation.respondedAt = new Date();
    await invitation.save();
    await notify([leader?.user], { type: 'group_invitation_declined', title: 'Invitation declined', body: `${req.user.name} declined to join "${group.name}".`, link: '/student/group' });
    return ok(res, { invitation });
  }

  await assertNotInActiveGroup(req.user._id, 'You are already in an active group. Leave it before accepting another invitation.');
  await assertProjectEditable(group);
  await assertCapacity(group);
  const previous = group.members.find((m) => idStr(m.user) === idStr(req.user._id));
  if (previous) Object.assign(previous, { status: 'active', role: 'member', joinedAt: new Date(), leftAt: undefined });
  else group.members.push({ user: req.user._id, role: 'member' });
  await group.save();

  invitation.status = 'accepted';
  invitation.respondedAt = new Date();
  await invitation.save();
  await GroupInvitation.updateMany({ invitedUser: req.user._id, status: 'pending' }, { $set: { status: 'cancelled' } });
  await notify([leader?.user], { type: 'group_joined', title: 'Invitation accepted', body: `${req.user.name} joined "${group.name}".`, link: '/student/group' });
  await audit(req, { action: 'group.member_joined', entityType: 'ProjectGroup', entityId: group._id, project: group.project, scope: 'project', summary: `${req.user.name} accepted an invitation` });
  ok(res, { invitation, group: await shapeGroup(group) });
});

export const cancelInvitation = asyncHandler(async (req, res) => {
  if (!isId(req.params.id)) throw new AppError('Invitation not found', 404);
  const invitation = await GroupInvitation.findById(req.params.id);
  if (!invitation) throw new AppError('Invitation not found', 404);
  requireLeaderOf(await loadGroup(invitation.group), req.user);
  if (invitation.status !== 'pending') throw new AppError('Only pending invitations can be cancelled', 409);
  invitation.status = 'cancelled';
  await invitation.save();
  ok(res, { invitation });
});

export const leaveGroup = asyncHandler(async (req, res) => {
  const group = await loadGroup(req.params.id);
  const me = group.activeMember(req.user._id);
  if (!me) throw new AppError('You are not an active member of this group', 409);
  await assertProjectEditable(group);
  const others = group.activeMembers().filter((m) => idStr(m.user) !== idStr(req.user._id));

  if (me.role === 'leader' && others.length > 0) {
    throw new AppError('Transfer leadership to another member before leaving', 409);
  }
  me.status = 'left';
  me.leftAt = new Date();
  if (others.length === 0) {
    group.status = 'dissolved';
    await Project.updateOne({ _id: group.project }, { $set: { status: 'archived', archivedAt: new Date() } });
  }
  await group.save();
  await audit(req, { action: 'group.member_left', entityType: 'ProjectGroup', entityId: group._id, project: group.project, scope: 'project', summary: `${req.user.name} left the group` });
  if (others.length) {
    await notify(others.map((m) => m.user), { type: 'group_left', title: 'A member left your group', body: `${req.user.name} left "${group.name}".`, link: '/student/group' });
  }
  ok(res, { message: others.length ? 'You left the group' : 'You left the group and it was closed because no members remain' });
});

export const transferLeadership = asyncHandler(async (req, res) => {
  const group = await loadGroup(req.params.id);
  requireLeaderOf(group, req.user);
  const target = group.activeMember(req.body.userId);
  if (!target) throw new AppError('That student is not an active member of the group', 422);
  if (sameId(target.user, req.user._id)) throw new AppError('You are already the leader', 409);
  group.activeMember(req.user._id).role = 'member';
  target.role = 'leader';
  await group.save();
  await notify([target.user], { type: 'group_leader', title: 'You are now the Group Leader', body: `You can now submit official work for "${group.name}".`, link: '/student/group' });
  await audit(req, { action: 'group.leadership_transferred', entityType: 'ProjectGroup', entityId: group._id, project: group.project, scope: 'project', summary: 'Group leadership transferred' });
  ok(res, await shapeGroup(group));
});

export const removeMember = asyncHandler(async (req, res) => {
  const group = await loadGroup(req.params.id);
  requireLeaderOf(group, req.user);
  await assertProjectEditable(group);
  const target = group.activeMember(req.body.userId);
  if (!target) throw new AppError('That student is not an active member', 422);
  if (sameId(target.user, req.user._id)) throw new AppError('Use "Leave group" to leave yourself', 409);
  target.status = 'removed';
  target.leftAt = new Date();
  await group.save();
  await notify([target.user], { type: 'group_removed', title: 'You were removed from a group', body: `The leader removed you from "${group.name}".`, link: '/student/group' });
  await audit(req, { action: 'group.member_removed', entityType: 'ProjectGroup', entityId: group._id, project: group.project, scope: 'project', summary: 'A member was removed by the leader' });
  ok(res, await shapeGroup(group));
});

export const getGroup = asyncHandler(async (req, res) => {
  const group = await loadGroup(req.params.id);
  const isMember = group.members.some((m) => idStr(m.user) === idStr(req.user._id));
  const project = await Project.findById(group.project).lean();
  const isSupervisor = req.user.role === 'supervisor' && project && sameId(project.supervisor, req.user._id);
  if (req.user.role !== 'coordinator' && !isMember && !isSupervisor) throw new AppError('Group not found', 404);
  ok(res, await shapeGroup(group));
});

// ---------------- Coordinator ----------------
export const listGroups = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePage(req.query);
  const filter = {};
  if (['active', 'archived', 'dissolved'].includes(req.query.status)) filter.status = req.query.status;
  if (isId(req.query.department)) filter.department = req.query.department;
  if (isId(req.query.term)) filter.term = req.query.term;
  if (isId(req.query.batch)) filter.batch = req.query.batch;
  if (req.query.q) filter.name = new RegExp(escapeRegex(String(req.query.q).slice(0, 80)), 'i');
  if (req.query.noSupervisor === '1') {
    filter._id = { $in: await Project.find({ supervisor: { $exists: false } }).distinct('group') };
  }
  const [items, total] = await Promise.all([
    ProjectGroup.find(filter)
      .populate('department', 'name code')
      .populate('term', 'name')
      .populate('batch', 'name')
      .populate({ path: 'project', select: 'title status supervisor', populate: { path: 'supervisor', select: 'name' } })
      .populate(MEMBER_POPULATE)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    ProjectGroup.countDocuments(filter),
  ]);
  ok(res, items, 200, pageMeta(page, limit, total));
});

export const adminUpdateGroup = asyncHandler(async (req, res) => {
  const group = await loadGroup(req.params.id);
  const { action, userId, moveFromOtherGroup } = req.body;

  if (action === 'archive') {
    group.status = 'archived';
    await group.save();
  } else {
    if (!userId || !isId(userId)) throw new AppError('Choose a student', 422, { userId: 'Required' });
    if (action === 'add_member') {
      const student = await User.findOne({ _id: userId, role: 'student', isActive: true });
      if (!student) throw new AppError('Active student not found', 404);
      if (group.activeMember(userId)) throw new AppError('Already an active member', 409);
      const other = await findActiveGroupOf(userId);
      if (other) {
        if (!moveFromOtherGroup) throw new AppError(`This student is already in "${other.name}". Confirm the move to continue.`, 409, undefined, 'ALREADY_IN_GROUP');
        const m = other.activeMember(userId);
        if (m.role === 'leader' && other.activeMembers().length > 1) throw new AppError(`This student leads "${other.name}". Assign a new leader there first.`, 409);
        m.status = 'removed';
        m.leftAt = new Date();
        if (other.activeMembers().length === 0) other.status = 'dissolved';
        await other.save();
      }
      await assertCapacity(group);
      const previous = group.members.find((m) => idStr(m.user) === idStr(userId));
      const role = group.activeMembers().length === 0 ? 'leader' : 'member';
      if (previous) Object.assign(previous, { status: 'active', role, joinedAt: new Date(), leftAt: undefined });
      else group.members.push({ user: userId, role });
      await group.save();
      await notify([userId], { type: 'group_assigned', title: 'You were added to a group', body: `The coordinator added you to "${group.name}".`, link: '/student/group' });
    } else if (action === 'remove_member') {
      const m = group.activeMember(userId);
      if (!m) throw new AppError('Not an active member', 404);
      if (m.role === 'leader' && group.activeMembers().length > 1) throw new AppError('Assign a new leader before removing the current one', 409);
      m.status = 'removed';
      m.leftAt = new Date();
      if (group.activeMembers().length === 0) group.status = 'dissolved';
      await group.save();
      await notify([userId], { type: 'group_removed', title: 'You were removed from a group', body: `The coordinator removed you from "${group.name}".`, link: '/student/group' });
    } else if (action === 'set_leader') {
      const m = group.activeMember(userId);
      if (!m) throw new AppError('Not an active member', 404);
      group.members.forEach((x) => {
        if (x.status === 'active') x.role = 'member';
      });
      m.role = 'leader';
      await group.save();
      await notify([userId], { type: 'group_leader', title: 'You are now the Group Leader', body: `The coordinator made you leader of "${group.name}".`, link: '/student/group' });
    } else {
      throw new AppError('Unknown action', 422);
    }
  }
  await audit(req, { action: `group.admin_${action}`, entityType: 'ProjectGroup', entityId: group._id, project: group.project, scope: 'project', summary: `Coordinator: ${action.replace('_', ' ')} on "${group.name}"`, meta: { userId } });
  ok(res, await shapeGroup(group));
});

export const _internal = { mongoose };
