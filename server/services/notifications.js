import { Notification, User, ProjectGroup, Project } from '../models/index.js';
import { emitToUser } from '../sockets/io.js';
import { idStr } from '../utils/helpers.js';

const PREF_BY_TYPE = { chat_message: 'chat', feedback: 'feedback', deadline: 'deadlines', meeting_reminder: 'deadlines' };

/**
 * Creates persistent notifications and pushes them live over Socket.IO.
 *  - dedupeKey: the same event can never notify the same person twice
 *  - refresh:   if a notification with this key already exists, update it and mark it unread again
 *               (used for chat so 20 messages do not create 20 notifications)
 */
export async function notify(userIds, { type, title, body, link, dedupeKey, refresh = false }) {
  const ids = [...new Set((userIds || []).filter(Boolean).map(idStr))];
  if (!ids.length) return [];

  const users = await User.find({ _id: { $in: ids }, isActive: true }).select('notificationPrefs institution').lean();
  const created = [];

  for (const u of users) {
    const prefKey = PREF_BY_TYPE[type];
    if (prefKey && u.notificationPrefs && u.notificationPrefs[prefKey] === false) continue;

    let doc = null;
    if (dedupeKey) {
      const existing = await Notification.findOne({ user: u._id, dedupeKey });
      if (existing) {
        if (!refresh) continue;
        existing.set({ title, body, link, readAt: null });
        existing.markModified('readAt');
        doc = await existing.save();
      }
    }
    if (!doc) {
      try {
        doc = await Notification.create({ institution: u.institution, user: u._id, type, title, body, link, dedupeKey });
      } catch (err) {
        if (err.code === 11000) continue; // created by a parallel request - fine
        throw err;
      }
    }
    created.push(doc);
    emitToUser(u._id, 'notification:new', doc.toJSON());
  }
  return created;
}

/** Active students of a project's group plus its supervisor (minus whoever caused the event). */
export async function projectParticipantIds(projectOrId, { exclude, includeSupervisor = true, includeStudents = true } = {}) {
  const project = projectOrId?._id ? projectOrId : await Project.findById(projectOrId).lean();
  if (!project) return [];
  const ids = [];
  if (includeStudents) {
    const group = await ProjectGroup.findById(project.group).lean();
    for (const m of group?.members || []) if (m.status === 'active') ids.push(idStr(m.user));
  }
  if (includeSupervisor && project.supervisor) ids.push(idStr(project.supervisor));
  const skip = idStr(exclude);
  return [...new Set(ids)].filter((id) => id && id !== skip);
}

export async function coordinatorIds() {
  const rows = await User.find({ role: 'coordinator', isActive: true }).select('_id').lean();
  return rows.map((r) => idStr(r._id));
}
