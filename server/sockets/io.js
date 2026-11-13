// Holds the Socket.IO server so services can push live events without circular imports.
let ioInstance = null;

export const setIO = (io) => {
  ioInstance = io;
};
export const getIO = () => ioInstance;

export const emitToUser = (userId, event, payload) => {
  if (ioInstance) ioInstance.to(`user:${userId}`).emit(event, payload);
};

export const emitToConversation = (conversationId, event, payload) => {
  if (ioInstance) ioInstance.to(`conv:${conversationId}`).emit(event, payload);
};
