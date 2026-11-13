import { Server } from 'socket.io';
import env from '../config/env.js';
import { tokenFromCookieHeader, userFromToken } from '../middleware/auth.js';
import { loadConversationForUser } from '../services/access.js';
import { Message, Conversation, Project } from '../models/index.js';
import { setIO } from './io.js';
import { scopedProjectIds } from '../services/access.js';
import { idStr } from '../utils/helpers.js';
import { runInInstitution } from '../utils/tenant.js';

/**
 * Socket.IO server.
 *  - Every connection is authenticated with the same HttpOnly JWT cookie as the REST API.
 *  - A user can only join a conversation room after the server confirms they are a participant,
 *    so guessing a conversation id gives nothing.
 */
export function initSockets(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: env.clientOrigin, credentials: true },
    maxHttpBufferSize: 1e5,
  });
  setIO(io);

  io.use(async (socket, next) => {
    try {
      socket.data.user = await userFromToken(tokenFromCookieHeader(socket.handshake.headers.cookie));
      next();
    } catch (err) {
      next(new Error(err.message || 'Unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const user = socket.data.user;
    // every database query below is limited to this user's institution
    const scoped = (fn) => (...args) => runInInstitution(user.institution, () => fn(...args));
    socket.join(`user:${user._id}`);

    scoped(async () => {

    // Join the rooms of every conversation this user may access.
    try {
      if (['student', 'supervisor'].includes(user.role)) {
        const ids = await scopedProjectIds(user);
        const convs = await Conversation.find({ project: { $in: ids } }).select('_id type').lean();
        for (const c of convs) {
          if (user.role === 'supervisor' && c.type !== 'supervision') continue;
          socket.join(`conv:${c._id}`);
        }
      }
    } catch (err) {
      console.error('[socket] could not join rooms:', err.message);
    }
    })();

    // Joining a newly created conversation: re-checked on the server every time.
    socket.on('conversation:join', scoped(async (conversationId, ack) => {
      try {
        const { conversation } = await loadConversationForUser(user, conversationId);
        socket.join(`conv:${conversation._id}`);
        if (typeof ack === 'function') ack({ ok: true });
      } catch {
        if (typeof ack === 'function') ack({ ok: false });
      }
    }));

    socket.on('typing', scoped(async ({ conversationId, isTyping } = {}) => {
      try {
        await loadConversationForUser(user, conversationId);
        socket.to(`conv:${conversationId}`).emit('typing', {
          conversationId: idStr(conversationId),
          userId: idStr(user._id),
          name: user.name,
          isTyping: Boolean(isTyping),
        });
      } catch {
        /* not a participant: ignore silently */
      }
    }));
  });

  return io;
}

export const _deps = { Message, Project };
