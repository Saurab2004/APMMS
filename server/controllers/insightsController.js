import { Milestone, Meeting, Project, ProgressReport, AcademicTerm } from '../models/index.js';
import { asyncHandler, ok, idStr } from '../utils/helpers.js';
import { loadProjectAccess, scopedProjectIds } from '../services/access.js';
import { findSimilar } from '../services/similarity.js';
import { AppError } from '../utils/AppError.js';

/** Similar projects. Students only see titles/terms (not other groups' names); staff also see the group. */
export const similarProjects = asyncHandler(async (req, res) => {
  const { project, access } = await loadProjectAccess(req.user, req.params.projectId);
  if (access === 'evaluator') throw new AppError('Project not found', 404);
  const result = await findSimilar(project._id);
  const staff = access === 'supervisor' || access === 'coordinator';
  ok(res, {
    checked: result.checked,
    matches: result.matches.map((m) => ({ score: m.score, level: m.level, title: m.title, term: m.term, status: m.status, ...(staff ? { group: m.group, projectId: m.projectId } : {}) })),
  });
});

const parseDate = (v, fallback) => (v && !Number.isNaN(Date.parse(v)) ? new Date(v) : fallback);

/** One list of dated things the signed-in user cares about, between two dates. */
export const calendar = asyncHandler(async (req, res) => {
  const now = new Date();
  const from = parseDate(req.query.from, new Date(now.getFullYear(), now.getMonth(), 1));
  const to = parseDate(req.query.to, new Date(now.getFullYear(), now.getMonth() + 1, 1));
  if (to - from > 100 * 864e5) throw new AppError('Choose a shorter date range', 422);
  const ids = await scopedProjectIds(req.user);
  const scope = ids ? { project: { $in: ids } } : {};

  const [milestones, meetings, reports, term] = await Promise.all([
    Milestone.find({ ...scope, plannedDate: { $gte: from, $lt: to } }).select('title plannedDate status project').lean(),
    Meeting.find({ ...scope, scheduledAt: { $gte: from, $lt: to }, status: { $ne: 'cancelled' } }).select('title scheduledAt status location project').lean(),
    ProgressReport.find({ ...scope, deadline: { $gte: from, $lt: to }, status: { $in: ['draft', 'revision_required'] } }).select('title deadline status project').lean(),
    AcademicTerm.findOne({ isCurrent: true }).lean(),
  ]);
  const projects = await Project.find({ _id: { $in: [...new Set([...milestones, ...meetings, ...reports].map((e) => idStr(e.project)))] } }).populate('group', 'name').select('title group').lean();
  const group = new Map(projects.map((p) => [idStr(p._id), { id: p._id, group: p.group?.name }]));
  const ref = (e) => group.get(idStr(e.project)) || {};

  const events = [
    ...milestones.map((e) => ({ id: `m${e._id}`, type: 'milestone', title: e.title, date: e.plannedDate, status: e.status, projectId: ref(e).id, group: ref(e).group })),
    ...meetings.map((e) => ({ id: `t${e._id}`, type: 'meeting', title: e.title, date: e.scheduledAt, status: e.status, place: e.location, projectId: ref(e).id, group: ref(e).group })),
    ...reports.map((e) => ({ id: `r${e._id}`, type: 'report', title: `Report due: ${e.title}`, date: e.deadline, status: e.status, projectId: ref(e).id, group: ref(e).group })),
  ];
  for (const [key, label] of [['proposal', 'Proposal deadline'], ['finalReport', 'Final report deadline']]) {
    const d = term?.deadlines?.[key];
    if (d && d >= from && d < to) events.push({ id: `d${key}`, type: 'deadline', title: label, date: d, status: 'pending' });
  }
  events.sort((a, b) => new Date(a.date) - new Date(b.date));
  ok(res, events);
});
