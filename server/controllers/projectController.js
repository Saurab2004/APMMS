import { Project, Proposal, Milestone, ProgressReport, AuditLog, User, ProjectGroup } from '../models/index.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler, ok, parsePage, pageMeta, escapeRegex, isId, idStr } from '../utils/helpers.js';
import { PROJECT_STATUS, computeProgress, isMilestoneOverdue } from '../utils/workflow.js';
import { loadProjectAccess, scopedProjectIds, studentProject, requireLeader } from '../services/access.js';
import { audit } from '../services/audit.js';
import { notify, projectParticipantIds } from '../services/notifications.js';

const MEMBER_POPULATE = { path: 'members.user', select: 'name email studentId' };

export const listProjects = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePage(req.query);
  const filter = {};
  const ids = await scopedProjectIds(req.user);
  if (ids) filter._id = { $in: ids };
  if (PROJECT_STATUS.includes(req.query.status)) filter.status = req.query.status;
  if (isId(req.query.department)) filter.department = req.query.department;
  if (isId(req.query.term)) filter.term = req.query.term;
  if (req.query.supervisor === 'none') filter.supervisor = { $exists: false };
  else if (isId(req.query.supervisor)) filter.supervisor = req.query.supervisor;
  if (req.query.q) {
    const rx = new RegExp(escapeRegex(String(req.query.q).slice(0, 80)), 'i');
    const groupIds = await ProjectGroup.find({ name: rx }).distinct('_id');
    filter.$or = [{ title: rx }, { group: { $in: groupIds } }];
  }

  const [items, total] = await Promise.all([
    Project.find(filter)
      .populate('group', 'name code status')
      .populate('supervisor', 'name email')
      .populate('department', 'name code')
      .populate('term', 'name')
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Project.countDocuments(filter),
  ]);

  const pIds = items.map((p) => p._id);
  const [proposals, milestones] = await Promise.all([
    Proposal.find({ project: { $in: pIds } }).select('project status').lean(),
    Milestone.find({ project: { $in: pIds } }).select('project status progress plannedDate').lean(),
  ]);
  const proposalMap = new Map(proposals.map((p) => [idStr(p.project), p.status]));
  const msByProject = new Map();
  for (const m of milestones) {
    const k = idStr(m.project);
    if (!msByProject.has(k)) msByProject.set(k, []);
    msByProject.get(k).push(m);
  }
  const data = items.map((p) => {
    const ms = msByProject.get(idStr(p._id)) || [];
    return {
      ...p,
      proposalStatus: proposalMap.get(idStr(p._id)) || null,
      progress: computeProgress(ms),
      overdueMilestones: ms.filter((m) => isMilestoneOverdue(m)).length,
    };
  });
  ok(res, data, 200, pageMeta(page, limit, total));
});

export const myProject = asyncHandler(async (req, res) => {
  const { project } = await studentProject(req.user);
  ok(res, { projectId: project?._id || null });
});

export const getProject = asyncHandler(async (req, res) => {
  const { project, group, access } = await loadProjectAccess(req.user, req.params.id);
  await group.populate(MEMBER_POPULATE);

  if (access === 'evaluator') {
    // External evaluators see the minimum needed for an evaluation.
    return ok(res, {
      access,
      project: { _id: project._id, title: project.title, summary: project.summary, technologies: project.technologies, status: project.status },
      group: { name: group.name, members: group.activeMembers().map((m) => ({ name: m.user.name })) },
    });
  }

  await project.populate([
    { path: 'supervisor', select: 'name email designation' },
    { path: 'department', select: 'name code' },
    { path: 'term', select: 'name academicYear deadlines' },
    { path: 'supervisorHistory.supervisor', select: 'name' },
    { path: 'supervisorHistory.assignedBy', select: 'name' },
  ]);
  const [proposal, milestones, reportAgg] = await Promise.all([
    Proposal.findOne({ project: project._id }).select('status currentVersion approvedVersion submittedAt').lean(),
    Milestone.find({ project: project._id }).select('status progress plannedDate').lean(),
    ProgressReport.aggregate([{ $match: { project: project._id } }, { $group: { _id: { kind: '$kind', status: '$status' }, n: { $sum: 1 } } }]),
  ]);
  const reports = { progress: {}, final: {} };
  for (const r of reportAgg) reports[r._id.kind][r._id.status] = r.n;

  ok(res, {
    access,
    project: project.toJSON(),
    group: group.toJSON(),
    proposal,
    progress: computeProgress(milestones),
    overdueMilestones: milestones.filter((m) => isMilestoneOverdue(m)).length,
    reports,
  });
});

/** Group Leader edits official project details; the Coordinator can edit anything. */
export const updateProject = asyncHandler(async (req, res) => {
  const { project, access } = await loadProjectAccess(req.user, req.params.id);
  const { title, summary, technologies } = req.body;
  if (access === 'leader') {
    if (['final_review', 'ready_for_evaluation', 'evaluated', 'completed', 'archived'].includes(project.status)) {
      throw new AppError('Project details are locked after final submission', 409);
    }
    if (title !== undefined && !['forming', 'proposal'].includes(project.status)) {
      throw new AppError('The title is fixed once the proposal is approved. Ask the coordinator for a change.', 409);
    }
  } else if (access === 'member') {
    requireLeader(access);
  } else if (access !== 'coordinator') {
    throw new AppError('You cannot edit this project', 403);
  }
  if (title !== undefined) project.title = title;
  if (summary !== undefined) project.summary = summary;
  if (technologies !== undefined) project.technologies = technologies;
  await project.save();
  await audit(req, { action: 'project.updated', entityType: 'Project', entityId: project._id, project: project._id, scope: 'project', summary: 'Project details updated' });
  ok(res, project);
});

export const assignSupervisor = asyncHandler(async (req, res) => {
  const { project } = await loadProjectAccess(req.user, req.params.id);
  const { supervisorId, force } = req.body;
  const supervisor = await User.findOne({ _id: supervisorId, role: 'supervisor', isActive: true });
  if (!supervisor) throw new AppError('Active supervisor not found', 404, { supervisorId: 'Not found' });
  if (idStr(project.supervisor) === idStr(supervisor._id)) throw new AppError('This supervisor is already assigned', 409);

  const load = await Project.countDocuments({ supervisor: supervisor._id, status: { $nin: ['archived', 'completed'] } });
  if (load >= supervisor.maxProjects && !force) {
    throw new AppError(`${supervisor.name} already supervises ${load} projects (capacity ${supervisor.maxProjects}). Confirm to assign anyway.`, 409, undefined, 'CAPACITY_EXCEEDED');
  }
  const now = new Date();
  const open = project.supervisorHistory.find((h) => !h.unassignedAt);
  if (open) open.unassignedAt = now;
  project.supervisorHistory.push({ supervisor: supervisor._id, assignedBy: req.user._id, assignedAt: now });
  project.supervisor = supervisor._id;
  await project.save();

  const members = await projectParticipantIds(project, { includeSupervisor: false });
  await notify(members, { type: 'project_assigned', title: 'Supervisor assigned', body: `${supervisor.name} is now your project supervisor.`, link: '/student/project' });
  await notify([supervisor._id], { type: 'project_assigned', title: 'New project assigned', body: `You were assigned the project "${project.title}".`, link: `/supervisor/projects/${project._id}` });
  await audit(req, { action: 'project.supervisor_assigned', entityType: 'Project', entityId: project._id, project: project._id, scope: 'project', summary: `Supervisor ${supervisor.name} assigned`, meta: { supervisorId } });
  ok(res, await Project.findById(project._id).populate('supervisor', 'name email'));
});

export const setProjectStatus = asyncHandler(async (req, res) => {
  const { project } = await loadProjectAccess(req.user, req.params.id);
  const { status } = req.body;
  const before = project.status;
  project.status = status;
  if (status === 'archived') project.archivedAt = new Date();
  await project.save();
  const people = await projectParticipantIds(project);
  await notify(people, { type: 'project_status', title: 'Project status changed', body: `Your project is now "${status.replace(/_/g, ' ')}".`, link: '/student/project' });
  await audit(req, { action: 'project.status_changed', entityType: 'Project', entityId: project._id, project: project._id, scope: 'project', summary: `Status ${before} -> ${status}` });
  ok(res, project);
});

export const projectTimeline = asyncHandler(async (req, res) => {
  const { project } = await loadProjectAccess(req.user, req.params.id);
  const { page, limit, skip } = parsePage(req.query, { defaultLimit: 30 });
  const filter = { project: project._id, scope: 'project' };
  const [items, total] = await Promise.all([
    AuditLog.find(filter).populate('actor', 'name role').sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    AuditLog.countDocuments(filter),
  ]);
  ok(res, items.map(({ ip, meta, ...rest }) => rest), 200, pageMeta(page, limit, total));
});
