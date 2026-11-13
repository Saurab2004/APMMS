import { Milestone, InteractionLog, Meeting, ProgressReport, Project } from '../models/index.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler, ok, parsePage, pageMeta, isId, idStr, addDays } from '../utils/helpers.js';
import { isMilestoneOverdue, REPORT_AWAITING_REVIEW } from '../utils/workflow.js';
import { loadProjectAccess, scopedProjectIds, isStudentAccess, requireReviewer } from '../services/access.js';
import { audit } from '../services/audit.js';
import { notify, projectParticipantIds } from '../services/notifications.js';

const noEvaluator = (access) => {
  if (access === 'evaluator') throw new AppError('Project not found', 404);
};

// ---------------- Milestones ----------------
export const listMilestones = asyncHandler(async (req, res) => {
  const filter = {};
  if (isId(req.query.project)) {
    const { project, access } = await loadProjectAccess(req.user, req.query.project);
    noEvaluator(access);
    filter.project = project._id;
  } else {
    const ids = await scopedProjectIds(req.user);
    if (req.user.role === 'evaluator') throw new AppError('Not allowed', 403);
    if (ids) filter.project = { $in: ids };
  }
  if (['pending', 'in_progress', 'completed', 'skipped'].includes(req.query.status)) filter.status = req.query.status;
  if (req.query.overdue === '1') Object.assign(filter, { status: { $in: ['pending', 'in_progress'] }, plannedDate: { $lt: new Date() } });
  if (req.query.upcoming === '1') Object.assign(filter, { status: { $in: ['pending', 'in_progress'] }, plannedDate: { $gte: new Date(), $lte: addDays(new Date(), 14) } });

  const { page, limit, skip } = parsePage(req.query, { defaultLimit: 50 });
  const [items, total] = await Promise.all([
    Milestone.find(filter).populate({ path: 'project', select: 'title group', populate: { path: 'group', select: 'name' } }).sort({ plannedDate: 1 }).skip(skip).limit(limit).lean(),
    Milestone.countDocuments(filter),
  ]);

  // Which reports are linked to these milestones? (to spot missing submissions)
  const reports = await ProgressReport.find({ milestone: { $in: items.map((m) => m._id) }, status: { $ne: 'draft' } }).select('milestone status').lean();
  const byMs = new Map();
  for (const r of reports) byMs.set(idStr(r.milestone), r.status);
  const data = items.map((m) => ({
    ...m,
    overdue: isMilestoneOverdue(m),
    reportStatus: byMs.get(idStr(m._id)) || null,
    missingReport: isMilestoneOverdue(m) && !byMs.has(idStr(m._id)),
  }));
  ok(res, data, 200, pageMeta(page, limit, total));
});

export const createMilestone = asyncHandler(async (req, res) => {
  const { project, access } = await loadProjectAccess(req.user, req.body.projectId);
  requireReviewer(access);
  const ms = await Milestone.create({
    project: project._id,
    title: req.body.title,
    description: req.body.description,
    plannedDate: req.body.plannedDate,
    createdBy: req.user._id,
  });
  const people = await projectParticipantIds(project, { exclude: req.user._id });
  await notify(people, { type: 'milestone', title: 'New milestone added', body: `"${ms.title}" is due ${ms.plannedDate.toDateString()}.`, link: '/student/project' });
  await audit(req, { action: 'milestone.created', entityType: 'Milestone', entityId: ms._id, project: project._id, scope: 'project', summary: `Milestone "${ms.title}" added` });
  ok(res, ms, 201);
});

async function loadMilestone(req) {
  if (!isId(req.params.id)) throw new AppError('Milestone not found', 404);
  const ms = await Milestone.findById(req.params.id);
  if (!ms) throw new AppError('Milestone not found', 404);
  const ctx = await loadProjectAccess(req.user, ms.project);
  requireReviewer(ctx.access);
  return { ms, ...ctx };
}

export const updateMilestone = asyncHandler(async (req, res) => {
  const { ms, project } = await loadMilestone(req);
  for (const f of ['title', 'description', 'plannedDate', 'status', 'progress', 'remarks']) if (req.body[f] !== undefined) ms[f] = req.body[f];
  if (ms.status === 'completed') {
    ms.progress = 100;
    ms.actualDate = ms.actualDate || new Date();
  } else if (req.body.status && req.body.status !== 'completed') ms.actualDate = undefined;
  await ms.save();
  await audit(req, { action: 'milestone.updated', entityType: 'Milestone', entityId: ms._id, project: project._id, scope: 'project', summary: `Milestone "${ms.title}" is now ${ms.status.replace('_', ' ')}` });
  ok(res, ms);
});

export const deleteMilestone = asyncHandler(async (req, res) => {
  const { ms, project } = await loadMilestone(req);
  if (await ProgressReport.exists({ milestone: ms._id })) {
    throw new AppError('Reports are linked to this milestone. Mark it as skipped instead of deleting.', 409);
  }
  await ms.deleteOne();
  await audit(req, { action: 'milestone.deleted', entityType: 'Milestone', entityId: ms._id, project: project._id, scope: 'project', summary: `Milestone "${ms.title}" removed` });
  ok(res, { message: 'Milestone removed' });
});

/** Supervisor / coordinator "progress monitoring": every project with progress, overdue and missing items. */
export const progressOverview = asyncHandler(async (req, res) => {
  const ids = await scopedProjectIds(req.user);
  const filter = { status: { $nin: ['archived', 'forming'] } };
  if (ids) filter._id = { $in: ids };
  const projects = await Project.find(filter).populate('group', 'name').populate('supervisor', 'name').lean();
  const pIds = projects.map((p) => p._id);
  const [milestones, reports] = await Promise.all([
    Milestone.find({ project: { $in: pIds } }).lean(),
    ProgressReport.find({ project: { $in: pIds }, status: { $ne: 'draft' } }).select('project milestone status isLate deadline').lean(),
  ]);
  const reportMs = new Set(reports.filter((r) => r.milestone).map((r) => idStr(r.milestone)));
  const rows = projects.map((p) => {
    const ms = milestones.filter((m) => idStr(m.project) === idStr(p._id));
    const rs = reports.filter((r) => idStr(r.project) === idStr(p._id));
    const active = ms.filter((m) => m.status !== 'skipped');
    const progress = active.length ? Math.round(active.reduce((s, m) => s + (m.status === 'completed' ? 100 : m.progress || 0), 0) / active.length) : 0;
    const overdue = ms.filter((m) => isMilestoneOverdue(m));
    return {
      _id: p._id,
      title: p.title,
      group: p.group,
      supervisor: p.supervisor,
      status: p.status,
      progress,
      milestones: ms.length,
      completedMilestones: ms.filter((m) => m.status === 'completed').length,
      overdueMilestones: overdue.length,
      missingReports: overdue.filter((m) => !reportMs.has(idStr(m._id))).length,
      awaitingReview: rs.filter((r) => REPORT_AWAITING_REVIEW.includes(r.status)).length,
      lateReports: rs.filter((r) => r.isLate).length,
    };
  });
  ok(res, rows);
});

// ---------------- Interaction logs ----------------
export const listLogs = asyncHandler(async (req, res) => {
  const filter = {};
  if (isId(req.query.project)) {
    const { project, access } = await loadProjectAccess(req.user, req.query.project);
    noEvaluator(access);
    filter.project = project._id;
  } else {
    if (req.user.role === 'evaluator') throw new AppError('Not allowed', 403);
    const ids = await scopedProjectIds(req.user);
    if (ids) filter.project = { $in: ids };
  }
  if (['open', 'responded', 'closed'].includes(req.query.status)) filter.status = req.query.status;
  const { page, limit, skip } = parsePage(req.query);
  const [items, total] = await Promise.all([
    InteractionLog.find(filter)
      .populate('author', 'name role')
      .populate('responses.author', 'name role')
      .populate({ path: 'project', select: 'title group', populate: { path: 'group', select: 'name' } })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    InteractionLog.countDocuments(filter),
  ]);
  ok(res, items, 200, pageMeta(page, limit, total));
});

export const createLog = asyncHandler(async (req, res) => {
  const { project, access } = await loadProjectAccess(req.user, req.body.projectId);
  if (!isStudentAccess(access)) throw new AppError('Only group members create interaction logs', 403);
  const log = await InteractionLog.create({ project: project._id, author: req.user._id, type: req.body.type, title: req.body.title, description: req.body.description });
  await notify(project.supervisor ? [project.supervisor] : [], {
    type: 'interaction_log',
    title: 'New interaction log',
    body: `${req.user.name}: ${log.title}`,
    link: '/supervisor/interaction-logs',
    dedupeKey: `log:${log._id}`,
  });
  await audit(req, { action: 'interaction_log.created', entityType: 'InteractionLog', entityId: log._id, project: project._id, scope: 'project', summary: `Interaction log "${log.title}"` });
  ok(res, log, 201);
});

async function loadLog(req) {
  if (!isId(req.params.id)) throw new AppError('Log not found', 404);
  const log = await InteractionLog.findById(req.params.id);
  if (!log) throw new AppError('Log not found', 404);
  const ctx = await loadProjectAccess(req.user, log.project);
  noEvaluator(ctx.access);
  if (ctx.access === 'coordinator') throw new AppError('Coordinators can view interaction logs but not respond to them', 403);
  return { log, ...ctx };
}

export const respondToLog = asyncHandler(async (req, res) => {
  const { log, project, access } = await loadLog(req);
  if (log.status === 'closed') throw new AppError('This log is closed', 409);
  log.responses.push({ author: req.user._id, message: req.body.message });
  if (access === 'supervisor') log.status = 'responded';
  await log.save();
  const targets = access === 'supervisor' ? await projectParticipantIds(project, { includeSupervisor: false, exclude: req.user._id }) : project.supervisor ? [project.supervisor] : [];
  await notify(targets, { type: 'interaction_log', title: 'New response on an interaction log', body: `${req.user.name}: ${req.body.message.slice(0, 120)}`, link: access === 'supervisor' ? '/student/interaction-log' : '/supervisor/interaction-logs' });
  ok(res, log);
});

export const setLogStatus = asyncHandler(async (req, res) => {
  const { log, access } = await loadLog(req);
  if (access !== 'supervisor') throw new AppError('Only the supervisor can change the status', 403);
  log.status = req.body.status;
  await log.save();
  ok(res, log);
});

// ---------------- Meetings ----------------
export const listMeetings = asyncHandler(async (req, res) => {
  const filter = {};
  if (isId(req.query.project)) {
    const { project, access } = await loadProjectAccess(req.user, req.query.project);
    noEvaluator(access);
    filter.project = project._id;
  } else {
    if (req.user.role === 'evaluator') throw new AppError('Not allowed', 403);
    const ids = await scopedProjectIds(req.user);
    if (ids) filter.project = { $in: ids };
  }
  if (['scheduled', 'completed', 'cancelled'].includes(req.query.status)) filter.status = req.query.status;
  if (req.query.upcoming === '1') Object.assign(filter, { status: 'scheduled', scheduledAt: { $gte: new Date() } });
  const { page, limit, skip } = parsePage(req.query);
  const [items, total] = await Promise.all([
    Meeting.find(filter).populate({ path: 'project', select: 'title group', populate: { path: 'group', select: 'name' } }).sort({ scheduledAt: req.query.upcoming === '1' ? 1 : -1 }).skip(skip).limit(limit).lean(),
    Meeting.countDocuments(filter),
  ]);
  ok(res, items, 200, pageMeta(page, limit, total));
});

export const createMeeting = asyncHandler(async (req, res) => {
  const { project, access } = await loadProjectAccess(req.user, req.body.projectId);
  requireReviewer(access);
  const { projectId, ...fields } = req.body;
  const meeting = await Meeting.create({ ...fields, project: project._id, createdBy: req.user._id });
  const people = await projectParticipantIds(project, { exclude: req.user._id });
  await notify(people, { type: 'meeting', title: 'Meeting scheduled', body: `${meeting.title} on ${meeting.scheduledAt.toLocaleString()}`, link: '/student/meetings', dedupeKey: `meeting-created:${meeting._id}` });
  await audit(req, { action: 'meeting.scheduled', entityType: 'Meeting', entityId: meeting._id, project: project._id, scope: 'project', summary: `Meeting "${meeting.title}" scheduled` });
  ok(res, meeting, 201);
});

export const updateMeeting = asyncHandler(async (req, res) => {
  if (!isId(req.params.id)) throw new AppError('Meeting not found', 404);
  const meeting = await Meeting.findById(req.params.id);
  if (!meeting) throw new AppError('Meeting not found', 404);
  const { project, access } = await loadProjectAccess(req.user, meeting.project);
  requireReviewer(access);
  const before = meeting.scheduledAt.getTime();
  for (const f of ['title', 'agenda', 'scheduledAt', 'durationMin', 'location', 'status', 'minutes', 'actionItems']) if (req.body[f] !== undefined) meeting[f] = req.body[f];
  await meeting.save();
  const people = await projectParticipantIds(project, { exclude: req.user._id });
  if (req.body.status === 'cancelled') {
    await notify(people, { type: 'meeting', title: 'Meeting cancelled', body: meeting.title, link: '/student/meetings' });
  } else if (req.body.scheduledAt && meeting.scheduledAt.getTime() !== before) {
    await notify(people, { type: 'meeting', title: 'Meeting rescheduled', body: `${meeting.title} is now ${meeting.scheduledAt.toLocaleString()}`, link: '/student/meetings' });
  } else if (req.body.minutes) {
    await notify(people, { type: 'meeting', title: 'Meeting minutes added', body: meeting.title, link: '/student/meetings' });
  }
  await audit(req, { action: 'meeting.updated', entityType: 'Meeting', entityId: meeting._id, project: project._id, scope: 'project', summary: `Meeting "${meeting.title}" updated (${meeting.status})` });
  ok(res, meeting);
});
