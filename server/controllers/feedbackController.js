import { FeedbackThread, FeedbackComment } from '../models/index.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler, ok, parsePage, pageMeta, isId, idStr } from '../utils/helpers.js';
import { loadProjectAccess, scopedProjectIds } from '../services/access.js';
import { notify, projectParticipantIds } from '../services/notifications.js';
import { audit } from '../services/audit.js';

async function loadThread(req) {
  if (!isId(req.params.id)) throw new AppError('Thread not found', 404);
  const thread = await FeedbackThread.findById(req.params.id);
  if (!thread) throw new AppError('Thread not found', 404);
  const ctx = await loadProjectAccess(req.user, thread.project);
  if (ctx.access === 'evaluator') throw new AppError('Thread not found', 404);
  return { thread, ...ctx };
}

export const listThreads = asyncHandler(async (req, res) => {
  if (req.user.role === 'evaluator') throw new AppError('Not allowed', 403);
  const filter = {};
  if (isId(req.query.project)) {
    const { project } = await loadProjectAccess(req.user, req.query.project);
    filter.project = project._id;
  } else {
    const ids = await scopedProjectIds(req.user);
    if (ids) filter.project = { $in: ids };
  }
  if (['general', 'proposal', 'report'].includes(req.query.kind)) filter.kind = req.query.kind;
  if (['open', 'closed'].includes(req.query.status)) filter.status = req.query.status;
  const { page, limit, skip } = parsePage(req.query);

  const [items, total] = await Promise.all([
    FeedbackThread.find(filter)
      .populate('createdBy', 'name role')
      .populate({ path: 'project', select: 'title group', populate: { path: 'group', select: 'name' } })
      .sort({ lastActivityAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    FeedbackThread.countDocuments(filter),
  ]);
  const unread = await FeedbackComment.aggregate([
    { $match: { thread: { $in: items.map((t) => t._id) }, $nor: [{ readBy: req.user._id }] } },
    { $group: { _id: '$thread', n: { $sum: 1 } } },
  ]);
  const unreadMap = new Map(unread.map((u) => [idStr(u._id), u.n]));
  // Latest comment of each thread (one small indexed query per thread on the current page)
  const last = await Promise.all(
    items.map(async (t) => {
      const c = await FeedbackComment.findOne({ thread: t._id }).sort({ createdAt: -1 }).select('body isFormal decision').lean();
      return c ? { _id: t._id, body: c.body, isFormal: c.isFormal, decision: c.decision } : null;
    })
  );
  const lastMap = new Map(last.filter(Boolean).map((l) => [idStr(l._id), l]));
  ok(res, items.map((t) => ({ ...t, unread: unreadMap.get(idStr(t._id)) || 0, last: lastMap.get(idStr(t._id)) || null })), 200, pageMeta(page, limit, total));
});

export const createThread = asyncHandler(async (req, res) => {
  const { project, access } = await loadProjectAccess(req.user, req.body.projectId);
  if (access === 'evaluator') throw new AppError('Project not found', 404);
  const thread = await FeedbackThread.create({ project: project._id, kind: 'general', title: req.body.title, createdBy: req.user._id });
  await FeedbackComment.create({ thread: thread._id, project: project._id, author: req.user._id, authorRole: req.user.role, body: req.body.body, readBy: [req.user._id] });
  const people = await projectParticipantIds(project, { exclude: req.user._id });
  await notify(people, { type: 'feedback', title: 'New feedback discussion', body: `${req.user.name}: ${thread.title}`, link: '/' + (req.user.role === 'supervisor' ? 'student' : 'supervisor') + '/feedback' });
  await audit(req, { action: 'feedback.thread_created', entityType: 'FeedbackThread', entityId: thread._id, project: project._id, scope: 'project', summary: `Discussion "${thread.title}" started` });
  ok(res, thread, 201);
});

export const getThread = asyncHandler(async (req, res) => {
  const { thread, project } = await loadThread(req);
  const comments = await FeedbackComment.find({ thread: thread._id }).populate('author', 'name role').sort({ createdAt: 1 }).lean();
  // Opening the thread marks everything as read for this user.
  await FeedbackComment.updateMany({ thread: thread._id, $nor: [{ readBy: req.user._id }] }, { $addToSet: { readBy: req.user._id } });
  await project.populate({ path: 'group', select: 'name' }).catch(() => {});
  ok(res, { thread, comments });
});

export const addComment = asyncHandler(async (req, res) => {
  const { thread, project, access } = await loadThread(req);
  if (thread.status === 'closed') throw new AppError('This discussion is closed', 409);
  if (access === 'coordinator' && req.user.role === 'coordinator') {
    // Coordinators may comment for oversight; they are not hidden participants.
  }
  const comment = await FeedbackComment.create({
    thread: thread._id,
    project: thread.project,
    author: req.user._id,
    authorRole: req.user.role,
    body: req.body.body,
    readBy: [req.user._id],
  });
  thread.lastActivityAt = new Date();
  await thread.save();
  const people = await projectParticipantIds(project, { exclude: req.user._id });
  await notify(people, {
    type: 'feedback',
    title: 'New feedback reply',
    body: `${req.user.name}: ${req.body.body.slice(0, 120)}`,
    link: `/${req.user.role === 'supervisor' ? 'student' : 'supervisor'}/feedback`,
    dedupeKey: `feedback:${thread._id}`,
    refresh: true,
  });
  ok(res, await comment.populate('author', 'name role'), 201);
});

export const setThreadStatus = asyncHandler(async (req, res) => {
  const { thread, access } = await loadThread(req);
  if (!['supervisor', 'coordinator'].includes(access)) throw new AppError('Only the supervisor can close a discussion', 403);
  thread.status = req.body.status;
  await thread.save();
  ok(res, thread);
});
