// Central place for "who may see / do what". Controllers call these helpers so the rules
// are not repeated (or forgotten) in individual endpoints.
import mongoose from 'mongoose';
import { Project, ProjectGroup, ExternalEvaluatorAssignment, Conversation } from '../models/index.js';
import { AppError } from '../utils/AppError.js';
import { idStr, sameId } from '../utils/helpers.js';

export async function evaluatorHasProject(userId, projectId) {
  return Boolean(
    await ExternalEvaluatorAssignment.exists({
      evaluator: userId,
      projects: projectId,
      status: 'active',
      expiresAt: { $gt: new Date() },
    })
  );
}

/**
 * Loads a project and works out how the current user relates to it:
 *   'coordinator' | 'supervisor' (assigned) | 'leader' | 'member' | 'evaluator'
 * Throws 404 if the user has no relationship (so project ids cannot be probed).
 */
export async function loadProjectAccess(user, projectId) {
  if (!mongoose.isValidObjectId(projectId)) throw new AppError('Project not found', 404);
  const project = await Project.findById(projectId);
  if (!project) throw new AppError('Project not found', 404);
  const group = await ProjectGroup.findById(project.group);

  let access = null;
  if (user.role === 'coordinator') {
    // A department coordinator only works with projects of their own department.
    if (user.coordinatorLevel === 'department' && String(project.department) !== String(user.department)) throw new AppError('Project not found', 404);
    access = 'coordinator';
  }
  else if (user.role === 'supervisor' && sameId(project.supervisor, user._id)) access = 'supervisor';
  else if (user.role === 'student' && group) {
    const m = group.activeMember(user._id);
    if (m) access = m.role === 'leader' ? 'leader' : 'member';
  } else if (user.role === 'evaluator' && (await evaluatorHasProject(user._id, project._id))) access = 'evaluator';

  if (!access) throw new AppError('Project not found', 404);
  return { project, group, access };
}

export const isStudentAccess = (access) => access === 'leader' || access === 'member';
export const isReviewerAccess = (access) => access === 'supervisor' || access === 'coordinator';

/** Only the Group Leader may perform official group-level actions. */
export function requireLeader(access) {
  if (access !== 'leader') {
    throw new AppError('Only the Group Leader can do this', 403);
  }
}

export function requireReviewer(access) {
  if (!isReviewerAccess(access)) throw new AppError('Only the assigned supervisor or the coordinator can do this', 403);
}

/**
 * Project ids the user may see. `null` means "all projects" (coordinator).
 */
export async function scopedProjectIds(user) {
  if (user.role === 'coordinator') return user.coordinatorLevel === 'department' ? Project.find({ department: user.department }).distinct('_id') : null;
  if (user.role === 'supervisor') return Project.find({ supervisor: user._id }).distinct('_id');
  if (user.role === 'student') {
    const groupIds = await ProjectGroup.find({
      status: 'active',
      activeMemberIds: user._id,
    }).distinct('_id');
    return Project.find({ group: { $in: groupIds } }).distinct('_id');
  }
  if (user.role === 'evaluator') {
    const rows = await ExternalEvaluatorAssignment.find({
      evaluator: user._id,
      status: 'active',
      expiresAt: { $gt: new Date() },
    }).select('projects');
    return rows.flatMap((r) => r.projects);
  }
  return [];
}

/** The project a student currently belongs to (through their active group). */
export async function studentProject(user) {
  const group = await ProjectGroup.findOne({
    status: 'active',
    activeMemberIds: user._id,
  });
  if (!group) return { group: null, project: null };
  const project = await Project.findById(group.project || undefined);
  return { group, project: project || (await Project.findOne({ group: group._id })) };
}

/** Who may take part in a conversation (students of the group; supervisor only in "supervision"). */
export async function conversationParticipantIds(conversation) {
  const project = await Project.findById(conversation.project).lean();
  if (!project) return [];
  const group = await ProjectGroup.findById(project.group).lean();
  const ids = (group?.members || []).filter((m) => m.status === 'active').map((m) => idStr(m.user));
  if (conversation.type === 'supervision' && project.supervisor) ids.push(idStr(project.supervisor));
  return ids;
}

/** Loads a conversation and verifies the user is a participant. Used by REST and Socket.IO alike. */
export async function loadConversationForUser(user, conversationId) {
  if (!mongoose.isValidObjectId(conversationId)) throw new AppError('Conversation not found', 404);
  const conversation = await Conversation.findById(conversationId);
  if (!conversation) throw new AppError('Conversation not found', 404);
  const participants = await conversationParticipantIds(conversation);
  if (!participants.includes(idStr(user._id))) throw new AppError('Conversation not found', 404);
  return { conversation, participants };
}
