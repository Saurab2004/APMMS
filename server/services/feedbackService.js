import { FeedbackThread, FeedbackComment } from '../models/index.js';

/**
 * Stores a formal review decision (proposal or report) as a structured feedback comment,
 * so it appears in the project's Feedback page next to ordinary discussion but is clearly marked "formal".
 */
export async function postFormalFeedback({ project, kind, refId, title, author, body, decision }) {
  let thread = await FeedbackThread.findOne({ project, kind, refId });
  if (!thread) thread = await FeedbackThread.create({ project, kind, refId, title, createdBy: author._id });
  const comment = await FeedbackComment.create({
    thread: thread._id,
    project,
    author: author._id,
    authorRole: author.role,
    body: body || `Decision: ${String(decision).replace('_', ' ')}`,
    isFormal: true,
    decision,
    readBy: [author._id],
  });
  thread.lastActivityAt = new Date();
  await thread.save();
  return comment;
}
