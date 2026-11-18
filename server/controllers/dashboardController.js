import { Project, ProjectGroup, Proposal, ProgressReport, Milestone, Meeting, FeedbackComment, Notification, GroupInvitation, User, Evaluation, ExternalEvaluatorAssignment, AuditLog, Department, AcademicTerm, ReportVersion, Message } from '../models/index.js';
import { asyncHandler, ok, isId, idStr, addDays, parsePage, pageMeta, escapeRegex } from '../utils/helpers.js';
import { computeProgress, isMilestoneOverdue, REPORT_AWAITING_REVIEW } from '../utils/workflow.js';
import { scopedProjectIds, studentProject } from '../services/access.js';
import { dirSize } from '../services/storage.js';
import { toCsv } from '../utils/csv.js';
import env from '../config/env.js';
import { dbState } from '../config/db.js';
import mongoose from 'mongoose';

// ---------------- Student ----------------
export const studentDashboard = asyncHandler(async (req, res) => {
  const { group, project } = await studentProject(req.user);
  const invitations = await GroupInvitation.countDocuments({ invitedUser: req.user._id, status: 'pending', expiresAt: { $gt: new Date() } });
  const unread = await Notification.countDocuments({ user: req.user._id, readAt: null });
  if (!group || !project) return ok(res, { hasGroup: false, invitations, unreadNotifications: unread });

  await group.populate('members.user', 'name');
  await project.populate('supervisor', 'name email');
  const [proposal, milestones, reports, meetings, term] = await Promise.all([
    Proposal.findOne({ project: project._id }).select('status currentVersion').lean(),
    Milestone.find({ project: project._id }).sort({ plannedDate: 1 }).lean(),
    ProgressReport.find({ project: project._id }).sort({ updatedAt: -1 }).limit(100).lean(),
    Meeting.find({ project: project._id, status: 'scheduled', scheduledAt: { $gte: new Date() } }).sort({ scheduledAt: 1 }).limit(3).lean(),
    AcademicTerm.findById(project.term).lean(),
  ]);
  const recentFeedback = await FeedbackComment.find({ project: project._id, author: { $ne: req.user._id } }).populate('author', 'name role').sort({ createdAt: -1 }).limit(4).lean();
  const now = new Date();
  const upcoming = milestones.filter((m) => ['pending', 'in_progress'].includes(m.status) && new Date(m.plannedDate) >= now).slice(0, 4);
  ok(res, {
    hasGroup: true,
    myRole: group.activeMember(req.user._id)?.role,
    group: { _id: group._id, name: group.name, code: group.code, members: group.activeMembers().map((m) => ({ _id: m.user._id, name: m.user.name, role: m.role })) },
    project: { _id: project._id, title: project.title, status: project.status, supervisor: project.supervisor },
    proposal,
    progress: computeProgress(milestones),
    milestones: milestones.map((m) => ({ _id: m._id, title: m.title, plannedDate: m.plannedDate, status: m.status, progress: m.progress, overdue: isMilestoneOverdue(m) })),
    upcomingMilestones: upcoming,
    overdueMilestones: milestones.filter((m) => isMilestoneOverdue(m)).length,
    reportCounts: {
      total: reports.filter((r) => r.kind === 'progress').length,
      awaitingReview: reports.filter((r) => REPORT_AWAITING_REVIEW.includes(r.status)).length,
      revisionRequired: reports.filter((r) => r.status === 'revision_required').length,
      approved: reports.filter((r) => r.status === 'approved' && r.kind === 'progress').length,
    },
    deadlines: { proposal: term?.deadlines?.proposal || null, finalReport: term?.deadlines?.finalReport || null },
    upcomingMeetings: meetings,
    recentFeedback: recentFeedback.map((f) => ({ _id: f._id, body: f.body.slice(0, 160), author: f.author, isFormal: f.isFormal, decision: f.decision, createdAt: f.createdAt })),
    invitations,
    unreadNotifications: unread,
  });
});

// ---------------- Supervisor ----------------
export const supervisorDashboard = asyncHandler(async (req, res) => {
  const ids = await scopedProjectIds(req.user);
  const now = new Date();
  const projects = await Project.find({ _id: { $in: ids }, status: { $ne: 'archived' } }).populate('group', 'name').lean();
  const pIds = projects.map((p) => p._id);
  const [pendingProposals, reports, milestones, meetings, feedback] = await Promise.all([
    Proposal.countDocuments({ project: { $in: pIds }, status: { $in: ['submitted', 'under_review'] } }),
    ProgressReport.find({ project: { $in: pIds }, status: { $ne: 'draft' } }).select('project kind status isLate deadline title submittedAt').lean(),
    Milestone.find({ project: { $in: pIds } }).lean(),
    Meeting.find({ project: { $in: pIds }, status: 'scheduled', scheduledAt: { $gte: now } }).populate({ path: 'project', select: 'group', populate: { path: 'group', select: 'name' } }).sort({ scheduledAt: 1 }).limit(4).lean(),
    FeedbackComment.find({ project: { $in: pIds }, author: { $ne: req.user._id } }).populate('author', 'name role').populate({ path: 'thread', select: 'title' }).sort({ createdAt: -1 }).limit(5).lean(),
  ]);
  const toReview = reports.filter((r) => REPORT_AWAITING_REVIEW.includes(r.status));
  const overdueMs = milestones.filter((m) => isMilestoneOverdue(m));
  const projectSummaries = projects.map((p) => {
    const ms = milestones.filter((m) => idStr(m.project) === idStr(p._id));
    return { _id: p._id, title: p.title, group: p.group, status: p.status, progress: computeProgress(ms), overdue: ms.filter((m) => isMilestoneOverdue(m)).length };
  });
  const upcomingMs = milestones.filter((m) => ['pending', 'in_progress'].includes(m.status) && new Date(m.plannedDate) >= now && new Date(m.plannedDate) <= addDays(now, 14)).sort((a, b) => new Date(a.plannedDate) - new Date(b.plannedDate)).slice(0, 5);
  const titleOf = new Map(projects.map((p) => [idStr(p._id), p.group?.name || p.title]));
  ok(res, {
    counts: {
      assignedProjects: projects.length,
      pendingProposals,
      reportsToReview: toReview.length,
      finalReportsToReview: toReview.filter((r) => r.kind === 'final').length,
      overdueSubmissions: overdueMs.length + reports.filter((r) => r.status === 'revision_required' && r.deadline && new Date(r.deadline) < now).length,
      lateReports: reports.filter((r) => r.isLate && REPORT_AWAITING_REVIEW.includes(r.status)).length,
    },
    projects: projectSummaries,
    upcomingDeadlines: upcomingMs.map((m) => ({ _id: m._id, title: m.title, plannedDate: m.plannedDate, group: titleOf.get(idStr(m.project)) })),
    upcomingMeetings: meetings,
    recentFeedback: feedback.map((f) => ({ _id: f._id, body: f.body.slice(0, 140), author: f.author, thread: f.thread?.title, createdAt: f.createdAt })),
    oldestPending: toReview.sort((a, b) => new Date(a.submittedAt) - new Date(b.submittedAt)).slice(0, 5).map((r) => ({ _id: r._id, title: r.title, submittedAt: r.submittedAt, group: titleOf.get(idStr(r.project)), isLate: r.isLate })),
  });
});

// ---------------- Coordinator ----------------
const lifecycleStages = ['forming', 'proposal', 'active', 'final_review', 'ready_for_evaluation', 'evaluated', 'completed', 'archived'];

export const coordinatorDashboard = asyncHandler(async (req, res) => {
  const now = new Date();
  // A department coordinator sees the numbers of their own department only.
  const dept = req.deptScope;
  const uf = dept ? { department: dept } : {};
  const pids = dept ? await Project.find({ department: dept }).distinct('_id') : null;
  const byP = pids ? { project: { $in: pids } } : {};
  const pendingApprovals = await User.countDocuments({ ...uf, approvalStatus: 'pending' });
  const [users, projectsByStatus, proposalsByStatus, reportsAgg, overdueMs, noSupervisor, ungrouped, evalCounts, recentAudit, supervisors] = await Promise.all([
    User.aggregate([{ $match: uf }, { $group: { _id: { r: '$role', a: '$isActive' }, n: { $sum: 1 } } }]),
    Project.aggregate([{ $match: uf }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
    Proposal.aggregate([{ $match: byP }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
    ProgressReport.aggregate([{ $match: { ...byP, status: { $ne: 'draft' } } }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
    Milestone.countDocuments({ ...byP, status: { $in: ['pending', 'in_progress'] }, plannedDate: { $lt: now } }),
    Project.countDocuments({ ...uf, supervisor: { $exists: false }, status: { $nin: ['archived'] } }),
    (async () => {
      const grouped = await ProjectGroup.find({ status: 'active' }).distinct('activeMemberIds');
      return User.countDocuments({ ...uf, role: 'student', isActive: true, _id: { $nin: grouped } });
    })(),
    Evaluation.aggregate([{ $match: byP }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
    dept ? [] : AuditLog.find().populate('actor', 'name role').sort({ createdAt: -1 }).limit(8).lean(),
    User.find({ ...uf, role: 'supervisor', isActive: true }).select('name maxProjects').lean(),
  ]);
  const uc = (role) => users.filter((u) => u._id.r === role && u._id.a).reduce((s, u) => s + u.n, 0);
  const load = await Project.aggregate([{ $match: { ...uf, supervisor: { $ne: null }, status: { $nin: ['archived', 'completed'] } } }, { $group: { _id: '$supervisor', n: { $sum: 1 } } }]);
  const stat = (arr, k) => arr.find((x) => x._id === k)?.n || 0;
  ok(res, {
    users: { students: uc('student'), supervisors: uc('supervisor'), coordinators: uc('coordinator'), evaluators: uc('evaluator') },
    projects: { total: projectsByStatus.reduce((s, x) => s + x.n, 0), byStatus: lifecycleStages.map((s) => ({ status: s, count: stat(projectsByStatus, s) })) },
    attention: {
      pendingApprovals,
      projectsWithoutSupervisor: noSupervisor,
      studentsWithoutGroup: ungrouped,
      proposalsPending: stat(proposalsByStatus, 'submitted') + stat(proposalsByStatus, 'under_review'),
      reportsAwaitingReview: REPORT_AWAITING_REVIEW.reduce((s, k) => s + stat(reportsAgg, k), 0),
      overdueMilestones: overdueMs,
      evaluationsSubmitted: stat(evalCounts, 'submitted'),
    },
    supervisorLoad: supervisors.map((s) => ({ _id: s._id, name: s.name, capacity: s.maxProjects, projects: load.find((l) => idStr(l._id) === idStr(s._id))?.n || 0 })).sort((a, b) => b.projects - a.projects).slice(0, 8),
    recentActivity: recentAudit.map(({ ip, meta, ...r }) => r),
  });
});

// ---------------- Analytics (coordinator) ----------------
async function matchingProjectIds(q, dept) {
  const f = {};
  if (isId(q.department)) f.department = q.department;
  if (dept) f.department = dept; // a department coordinator is always limited to their department
  if (isId(q.term)) f.term = q.term;
  if (isId(q.batch)) f.batch = q.batch;
  if (isId(q.supervisor)) f.supervisor = q.supervisor;
  if (q.status) f.status = q.status;
  if (!Object.keys(f).length) return null;
  return Project.find(f).distinct('_id');
}

export async function computeAnalytics(req) {
  const ids = await matchingProjectIds(req.query, req.deptScope);
  const pFilter = ids ? { _id: { $in: ids } } : {};
  const byProject = ids ? { project: { $in: ids } } : {};
  const now = new Date();

  const [stages, proposals, reports, milestones, deptRows, evalAgg, supervisorRows, depts] = await Promise.all([
    Project.aggregate([{ $match: pFilter }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
    Proposal.aggregate([{ $match: byProject }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
    ProgressReport.aggregate([{ $match: { ...byProject, status: { $ne: 'draft' } } }, { $group: { _id: { s: '$status', late: '$isLate' }, n: { $sum: 1 } } }]),
    Milestone.aggregate([{ $match: byProject }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
    Project.aggregate([{ $match: pFilter }, { $group: { _id: { d: '$department', s: '$status' }, n: { $sum: 1 } } }]),
    Evaluation.aggregate([{ $match: byProject }, { $group: { _id: { t: '$evaluatorType', s: '$status' }, n: { $sum: 1 } } }]),
    Project.aggregate([{ $match: { ...pFilter, supervisor: { $ne: null } } }, { $group: { _id: '$supervisor', projects: { $sum: 1 } } }]),
    Department.find().select('name code').lean(),
  ]);
  const overdueMilestones = await Milestone.countDocuments({ ...byProject, status: { $in: ['pending', 'in_progress'] }, plannedDate: { $lt: now } });
  const ACTIVE_STAGES = ['active', 'final_review', 'ready_for_evaluation'];
  const deptMap = new Map();
  for (const row of deptRows) {
    const k = idStr(row._id.d);
    const cur = deptMap.get(k) || { _id: row._id.d, projects: 0, active: 0 };
    cur.projects += row.n;
    if (ACTIVE_STAGES.includes(row._id.s)) cur.active += row.n;
    deptMap.set(k, cur);
  }
  const deptSummary = [...deptMap.values()];
  const sup = await User.find({ _id: { $in: supervisorRows.map((s) => s._id) } }).select('name').lean();
  const pending = await ProgressReport.countDocuments({ ...byProject, status: { $in: REPORT_AWAITING_REVIEW } });
  const getP = (k) => proposals.find((p) => p._id === k)?.n || 0;
  const decided = getP('approved') + getP('rejected');
  const submittedReports = reports.reduce((s, r) => s + r.n, 0);
  const evalTotal = evalAgg.reduce((s, e) => s + e.n, 0);
  const evalSubmitted = evalAgg.filter((e) => e._id.s === 'submitted').reduce((s, e) => s + e.n, 0);

  return {
    stages: lifecycleStages.map((s) => ({ status: s, count: stages.find((x) => x._id === s)?.n || 0 })),
    proposals: {
      byStatus: proposals.map((p) => ({ status: p._id, count: p.n })),
      approvalRate: decided ? Math.round((getP('approved') / decided) * 100) : null,
    },
    reports: {
      submitted: submittedReports,
      approved: reports.filter((r) => r._id.s === 'approved').reduce((s, r) => s + r.n, 0),
      late: reports.filter((r) => r._id.late).reduce((s, r) => s + r.n, 0),
      awaitingReview: pending,
      byStatus: Object.entries(reports.reduce((m, r) => ({ ...m, [r._id.s]: (m[r._id.s] || 0) + r.n }), {})).map(([status, count]) => ({ status, count })),
    },
    milestones: {
      total: milestones.reduce((s, m) => s + m.n, 0),
      completed: milestones.find((m) => m._id === 'completed')?.n || 0,
      overdue: overdueMilestones,
    },
    departments: deptSummary.map((d) => ({ department: depts.find((x) => idStr(x._id) === idStr(d._id))?.name || 'Unassigned', projects: d.projects, active: d.active })),
    supervisorWorkload: supervisorRows.map((s) => ({ name: sup.find((u) => idStr(u._id) === idStr(s._id))?.name || 'Unknown', projects: s.projects })).sort((a, b) => b.projects - a.projects),
    evaluation: { total: evalTotal, submitted: evalSubmitted, completion: evalTotal ? Math.round((evalSubmitted / evalTotal) * 100) : null },
  };
}

export const analytics = asyncHandler(async (req, res) => ok(res, await computeAnalytics(req)));

export const exportProjectsCsv = asyncHandler(async (req, res) => {
  const ids = await matchingProjectIds(req.query, req.deptScope);
  const projects = await Project.find(ids ? { _id: { $in: ids } } : {})
    .populate('group', 'name members')
    .populate('supervisor', 'name')
    .populate('department', 'name')
    .populate('term', 'name')
    .limit(5000)
    .lean();
  const proposals = await Proposal.find({ project: { $in: projects.map((p) => p._id) } }).select('project status').lean();
  const ms = await Milestone.find({ project: { $in: projects.map((p) => p._id) } }).select('project status progress plannedDate').lean();
  const csv = toCsv(projects, [
    { header: 'Project', value: (p) => p.title },
    { header: 'Group', value: (p) => p.group?.name },
    { header: 'Members', value: (p) => p.group?.members?.filter((m) => m.status === 'active').length },
    { header: 'Department', value: (p) => p.department?.name },
    { header: 'Term', value: (p) => p.term?.name },
    { header: 'Supervisor', value: (p) => p.supervisor?.name },
    { header: 'Status', value: (p) => p.status },
    { header: 'Proposal', value: (p) => proposals.find((x) => idStr(x.project) === idStr(p._id))?.status },
    { header: 'Progress %', value: (p) => computeProgress(ms.filter((m) => idStr(m.project) === idStr(p._id))) },
    { header: 'Results published', value: (p) => (p.resultsPublished ? 'yes' : 'no') },
  ]);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="projects.csv"');
  res.send(csv);
});

// ---------------- Audit logs & system info ----------------
export const listAuditLogs = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePage(req.query, { defaultLimit: 25 });
  const filter = {};
  if (req.query.action) filter.action = new RegExp(`^${escapeRegex(String(req.query.action).slice(0, 40))}`);
  if (isId(req.query.actor)) filter.actor = req.query.actor;
  if (req.query.from && !Number.isNaN(Date.parse(req.query.from))) filter.createdAt = { ...filter.createdAt, $gte: new Date(req.query.from) };
  if (req.query.to && !Number.isNaN(Date.parse(req.query.to))) filter.createdAt = { ...filter.createdAt, $lte: new Date(`${req.query.to}T23:59:59.999Z`) };
  if (req.query.q) filter.summary = new RegExp(escapeRegex(String(req.query.q).slice(0, 60)), 'i');
  const [items, total] = await Promise.all([
    AuditLog.find(filter).populate('actor', 'name role email').sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    AuditLog.countDocuments(filter),
  ]);
  ok(res, items, 200, pageMeta(page, limit, total));
});

export const systemInfo = asyncHandler(async (req, res) => {
  const owner = false; // server details (database host, disk) belong to the platform admin console, not to institutions
  const counts = {};
  const models = { users: User, projects: Project, projectgroups: ProjectGroup, proposals: Proposal, progressreports: ProgressReport, reportversions: ReportVersion, messages: Message, notifications: Notification, auditlogs: AuditLog };
  await Promise.all(
    Object.entries(models).map(async ([c, Model]) => {
      try {
        counts[c] = await Model.countDocuments({}); // limited to this institution automatically
      } catch {
        counts[c] = 0;
      }
    })
  );
  ok(res, {
    environment: env.nodeEnv,
    node: process.version,
    database: owner ? { state: dbState(), name: mongoose.connection.name, host: mongoose.connection.host } : { state: dbState() },
    uploads: owner ? { bytes: await dirSize(env.uploadDir), maxUploadMB: env.maxUploadMB } : { maxUploadMB: env.maxUploadMB },
    collections: counts,
    uptimeSeconds: Math.round(process.uptime()),
    backupAdvice: [
      'Back up the database:  mongodump --uri="mongodb://127.0.0.1:27017/apmms" --out=backup/YYYY-MM-DD',
      'Restore:  mongorestore --uri="mongodb://127.0.0.1:27017" backup/YYYY-MM-DD',
      'Back up the server/uploads folder together with the database - report files live there.',
      'Backups are not created automatically by this application.',
    ],
  });
});
