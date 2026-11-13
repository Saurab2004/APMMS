import { Notification, Announcement, User, Project, ProjectGroup } from '../models/index.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler, ok, parsePage, pageMeta, isId, idStr } from '../utils/helpers.js';
import { notify } from '../services/notifications.js';
import { audit } from '../services/audit.js';

export const listNotifications = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePage(req.query);
  const filter = { user: req.user._id };
  if (req.query.unread === '1') filter.readAt = null;
  const [items, total, unread] = await Promise.all([
    Notification.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Notification.countDocuments(filter),
    Notification.countDocuments({ user: req.user._id, readAt: null }),
  ]);
  ok(res, items, 200, { ...pageMeta(page, limit, total), unread });
});

export const unreadCount = asyncHandler(async (req, res) => {
  ok(res, { unread: await Notification.countDocuments({ user: req.user._id, readAt: null }) });
});

export const markRead = asyncHandler(async (req, res) => {
  if (!isId(req.params.id)) throw new AppError('Notification not found', 404);
  const n = await Notification.findOneAndUpdate({ _id: req.params.id, user: req.user._id }, { $set: { readAt: new Date() } }, { new: true });
  if (!n) throw new AppError('Notification not found', 404);
  ok(res, n);
});

export const markAllRead = asyncHandler(async (req, res) => {
  const r = await Notification.updateMany({ user: req.user._id, readAt: null }, { $set: { readAt: new Date() } });
  ok(res, { updated: r.modifiedCount });
});

// ---------------- Coordinator announcements ----------------
async function resolveRecipients(audience) {
  const { roles = [], departments = [], terms = [], projects = [] } = audience;
  const ids = new Set();
  const hasUserFilter = roles.length || departments.length || terms.length;
  if (hasUserFilter || !projects.length) {
    const q = { isActive: true, role: roles.length ? { $in: roles } : { $in: ['student', 'supervisor', 'coordinator'] } };
    if (departments.length) q.department = { $in: departments };
    if (terms.length) q.term = { $in: terms };
    (await User.find(q).select('_id').lean()).forEach((u) => ids.add(idStr(u._id)));
  }
  if (projects.length) {
    const ps = await Project.find({ _id: { $in: projects } }).lean();
    const groups = await ProjectGroup.find({ _id: { $in: ps.map((p) => p.group) } }).lean();
    groups.forEach((g) => g.members.filter((m) => m.status === 'active').forEach((m) => ids.add(idStr(m.user))));
    ps.forEach((p) => p.supervisor && ids.add(idStr(p.supervisor)));
  }
  return [...ids];
}

export const createAnnouncement = asyncHandler(async (req, res) => {
  const { title, body, roles = [], departments = [], terms = [], projects = [] } = req.body;
  const audience = { roles, departments, terms, projects };
  const recipients = await resolveRecipients(audience);
  if (!recipients.length) throw new AppError('No active users match this audience', 422);
  const a = await Announcement.create({ title, body, audience, recipientCount: recipients.length, createdBy: req.user._id });
  await notify(recipients, { type: 'announcement', title, body: body.slice(0, 300), link: '/notifications', dedupeKey: `announcement:${a._id}` });
  await audit(req, { action: 'announcement.sent', entityType: 'Announcement', entityId: a._id, summary: `Announcement "${title}" sent to ${recipients.length} users` });
  ok(res, a, 201);
});

export const listAnnouncements = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePage(req.query);
  const [items, total] = await Promise.all([
    Announcement.find().populate('createdBy', 'name').populate('audience.departments', 'name').populate('audience.terms', 'name').sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Announcement.countDocuments(),
  ]);
  ok(res, items, 200, pageMeta(page, limit, total));
});
