import './tenantPlugin.js';
import mongoose from 'mongoose';
import { fileSchema } from './shared.js';

const { Schema } = mongoose;

// ---------- Feedback (structured, project-linked) ----------
const threadSchema = new Schema(
  {
    project: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    kind: { type: String, enum: ['general', 'proposal', 'report'], default: 'general' },
    refId: { type: Schema.Types.ObjectId }, // the proposal or report this thread is about
    title: { type: String, required: true, trim: true, maxlength: 160 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, enum: ['open', 'closed'], default: 'open' },
    lastActivityAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);
threadSchema.index({ project: 1, lastActivityAt: -1 });
threadSchema.index({ project: 1, kind: 1, refId: 1 });

const commentSchema = new Schema(
  {
    thread: { type: Schema.Types.ObjectId, ref: 'FeedbackThread', required: true, index: true },
    project: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    author: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    authorRole: { type: String },
    body: { type: String, required: true, trim: true, maxlength: 4000 },
    isFormal: { type: Boolean, default: false }, // true for a review decision
    decision: { type: String, enum: ['approved', 'rejected', 'revision_required'] },
    readBy: [{ type: Schema.Types.ObjectId, ref: 'User' }],
  },
  { timestamps: true }
);
commentSchema.index({ thread: 1, createdAt: 1 });

// ---------- Chat ----------
const conversationSchema = new Schema(
  {
    project: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    // group = students only; supervision = students + the assigned supervisor
    type: { type: String, enum: ['group', 'supervision'], required: true },
    lastMessage: {
      text: { type: String },
      sender: { type: Schema.Types.ObjectId, ref: 'User' },
      at: { type: Date },
    },
  },
  { timestamps: true }
);
conversationSchema.index({ project: 1, type: 1 }, { unique: true });

const messageSchema = new Schema(
  {
    conversation: { type: Schema.Types.ObjectId, ref: 'Conversation', required: true },
    sender: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    senderRole: { type: String, required: true },
    text: { type: String, trim: true, maxlength: 2000 },
    attachments: { type: [fileSchema], default: [] },
    readBy: [new Schema({ user: { type: Schema.Types.ObjectId, ref: 'User' }, at: { type: Date, default: Date.now } }, { _id: false })],
  },
  { timestamps: true }
);
messageSchema.index({ conversation: 1, createdAt: -1 });

// ---------- Notifications & announcements ----------
const notificationSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, required: true, maxlength: 60 },
    title: { type: String, required: true, maxlength: 200 },
    body: { type: String, maxlength: 500 },
    link: { type: String, maxlength: 300 },
    dedupeKey: { type: String, maxlength: 200 },
    readAt: { type: Date },
  },
  { timestamps: true }
);
notificationSchema.index({ user: 1, readAt: 1, createdAt: -1 });
// Prevents accidental duplicate notifications for the same event
notificationSchema.index({ user: 1, dedupeKey: 1 }, { unique: true, partialFilterExpression: { dedupeKey: { $type: 'string' } } });

const announcementSchema = new Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 160 },
    body: { type: String, required: true, trim: true, maxlength: 3000 },
    audience: {
      roles: [{ type: String, enum: ['student', 'supervisor', 'coordinator'] }],
      departments: [{ type: Schema.Types.ObjectId, ref: 'Department' }],
      terms: [{ type: Schema.Types.ObjectId, ref: 'AcademicTerm' }],
      projects: [{ type: Schema.Types.ObjectId, ref: 'Project' }],
    },
    recipientCount: { type: Number, default: 0 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

export const FeedbackThread = mongoose.models.FeedbackThread || mongoose.model('FeedbackThread', threadSchema);
export const FeedbackComment = mongoose.models.FeedbackComment || mongoose.model('FeedbackComment', commentSchema);
export const Conversation = mongoose.models.Conversation || mongoose.model('Conversation', conversationSchema);
export const Message = mongoose.models.Message || mongoose.model('Message', messageSchema);
export const Notification = mongoose.models.Notification || mongoose.model('Notification', notificationSchema);
export const Announcement = mongoose.models.Announcement || mongoose.model('Announcement', announcementSchema);
