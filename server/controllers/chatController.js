import { Conversation, Message, Project, ProjectGroup } from '../models/index.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler, ok, isId, idStr, escapeRegex } from '../utils/helpers.js';
import { loadConversationForUser, scopedProjectIds } from '../services/access.js';
import { notify } from '../services/notifications.js';
import { saveMany, removeFile, sendStoredFile } from '../services/storage.js';
import { emitToConversation } from '../sockets/io.js';

/** Makes sure each project has its group conversation (and a supervision one once a supervisor is assigned). */
async function ensureConversation(projectId, type) {
  try {
    return await Conversation.findOneAndUpdate({ project: projectId, type }, { $setOnInsert: { project: projectId, type } }, { upsert: true, new: true });
  } catch (err) {
    if (err.code === 11000) return Conversation.findOne({ project: projectId, type }); // created by a parallel request
    throw err;
  }
}

export const listConversations = asyncHandler(async (req, res) => {
  if (!['student', 'supervisor'].includes(req.user.role)) return ok(res, []);
  const ids = await scopedProjectIds(req.user);
  const projects = await Project.find({ _id: { $in: ids }, status: { $ne: 'archived' } }).populate('group', 'name status').populate('supervisor', 'name').lean();

  const convs = [];
  for (const p of projects) {
    if (req.user.role === 'student') convs.push(await ensureConversation(p._id, 'group'));
    if (p.supervisor) convs.push(await ensureConversation(p._id, 'supervision'));
  }
  const pMap = new Map(projects.map((p) => [idStr(p._id), p]));
  const result = [];
  for (const c of convs) {
    const p = pMap.get(idStr(c.project));
    const unread = await Message.countDocuments({ conversation: c._id, sender: { $ne: req.user._id }, $nor: [{ 'readBy.user': req.user._id }] });
    const lastSender = c.lastMessage?.sender ? idStr(c.lastMessage.sender) : null;
    result.push({
      _id: c._id,
      type: c.type,
      title: c.type === 'group' ? `${p.group?.name || 'Group'} - team chat` : `${p.group?.name || 'Group'} - with supervisor`,
      projectId: p._id,
      projectTitle: p.title,
      supervisor: p.supervisor ? { _id: p.supervisor._id, name: p.supervisor.name } : null,
      lastMessage: c.lastMessage?.at ? { text: c.lastMessage.text, at: c.lastMessage.at, fromMe: lastSender === idStr(req.user._id) } : null,
      unread,
    });
  }
  result.sort((a, b) => new Date(b.lastMessage?.at || 0) - new Date(a.lastMessage?.at || 0));
  ok(res, result);
});

export const getMessages = asyncHandler(async (req, res) => {
  const { conversation } = await loadConversationForUser(req.user, req.params.id);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 30));
  const filter = { conversation: conversation._id };
  if (req.query.before && !Number.isNaN(Date.parse(req.query.before))) filter.createdAt = { $lt: new Date(req.query.before) };
  if (req.query.q) filter.text = new RegExp(escapeRegex(String(req.query.q).slice(0, 60)), 'i');
  const items = await Message.find(filter).populate('sender', 'name role').sort({ createdAt: -1 }).limit(limit + 1).lean();
  const hasMore = items.length > limit;
  const page = items.slice(0, limit).reverse();
  ok(res, page, 200, { hasMore, oldest: page[0]?.createdAt || null });
});

export const sendMessage = asyncHandler(async (req, res) => {
  const { conversation, participants } = await loadConversationForUser(req.user, req.params.id);
  const text = String(req.body.text || '').trim();
  if (text.length > 2000) throw new AppError('Messages can be at most 2000 characters', 422);
  const files = req.files || [];
  if (!text && !files.length) throw new AppError('Write a message or attach a file', 422);
  if (files.length > 3) throw new AppError('You can attach at most 3 files per message', 422);

  const attachments = await saveMany(files, { category: 'chat', scope: idStr(conversation._id), folder: 'chat' });
  let message;
  try {
    message = await Message.create({
      conversation: conversation._id,
      sender: req.user._id,
      senderRole: req.user.role,
      text,
      attachments,
      readBy: [{ user: req.user._id }],
    });
  } catch (err) {
    await Promise.all(attachments.map(removeFile));
    throw err;
  }
  conversation.lastMessage = { text: text || `Attachment: ${attachments[0]?.originalName}`, sender: req.user._id, at: message.createdAt };
  await conversation.save();

  const populated = await message.populate('sender', 'name role');
  emitToConversation(conversation._id, 'message:new', populated.toJSON());

  const others = participants.filter((id) => id !== idStr(req.user._id));
  const base = req.user.role === 'supervisor' ? '/student/chat' : '/supervisor/chat';
  await notify(others, {
    type: 'chat_message',
    title: `New message from ${req.user.name}`,
    body: (text || 'Sent an attachment').slice(0, 120),
    link: conversation.type === 'supervision' ? `${base}?c=${conversation._id}` : `/student/chat?c=${conversation._id}`,
    dedupeKey: `chat:${conversation._id}`,
    refresh: true,
  });
  ok(res, populated, 201);
});

export const markRead = asyncHandler(async (req, res) => {
  const { conversation } = await loadConversationForUser(req.user, req.params.id);
  const result = await Message.updateMany(
    { conversation: conversation._id, sender: { $ne: req.user._id }, $nor: [{ 'readBy.user': req.user._id }] },
    { $push: { readBy: { user: req.user._id, at: new Date() } } }
  );
  if (result.modifiedCount) emitToConversation(conversation._id, 'conversation:read', { conversationId: idStr(conversation._id), userId: idStr(req.user._id) });
  ok(res, { updated: result.modifiedCount });
});

export const downloadChatAttachment = asyncHandler(async (req, res) => {
  const { conversation } = await loadConversationForUser(req.user, req.params.id);
  if (!isId(req.params.messageId)) throw new AppError('File not found', 404);
  const message = await Message.findOne({ _id: req.params.messageId, conversation: conversation._id });
  const meta = message?.attachments?.[Number(req.params.index)];
  if (!meta) throw new AppError('File not found', 404);
  await sendStoredFile(res, meta, { inline: req.query.disposition === 'inline' });
});

export const _unused = { ProjectGroup };
