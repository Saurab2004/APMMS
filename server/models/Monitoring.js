import './tenantPlugin.js';
import mongoose from 'mongoose';

const { Schema } = mongoose;

const milestoneSchema = new Schema(
  {
    project: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 160 },
    description: { type: String, trim: true, maxlength: 1000 },
    plannedDate: { type: Date, required: true },
    actualDate: { type: Date },
    status: { type: String, enum: ['pending', 'in_progress', 'completed', 'skipped'], default: 'pending' },
    progress: { type: Number, min: 0, max: 100, default: 0 },
    remarks: { type: String, trim: true, maxlength: 1000 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);
milestoneSchema.index({ project: 1, plannedDate: 1 });
milestoneSchema.index({ status: 1, plannedDate: 1 });

const interactionLogSchema = new Schema(
  {
    project: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    author: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: ['update', 'discussion', 'issue', 'request'], default: 'update' },
    title: { type: String, required: true, trim: true, maxlength: 160 },
    description: { type: String, required: true, trim: true, maxlength: 3000 },
    status: { type: String, enum: ['open', 'responded', 'closed'], default: 'open' },
    responses: {
      type: [
        new Schema(
          {
            author: { type: Schema.Types.ObjectId, ref: 'User', required: true },
            message: { type: String, required: true, trim: true, maxlength: 2000 },
            createdAt: { type: Date, default: Date.now },
          },
          { _id: true }
        ),
      ],
      default: [],
      validate: [(v) => v.length <= 100, 'Too many responses on one log'],
    },
  },
  { timestamps: true }
);
interactionLogSchema.index({ project: 1, createdAt: -1 });

const meetingSchema = new Schema(
  {
    project: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 160 },
    agenda: { type: String, trim: true, maxlength: 2000 },
    scheduledAt: { type: Date, required: true },
    durationMin: { type: Number, min: 5, max: 600, default: 30 },
    location: { type: String, trim: true, maxlength: 200 }, // room or video link
    status: { type: String, enum: ['scheduled', 'completed', 'cancelled'], default: 'scheduled' },
    minutes: { type: String, trim: true, maxlength: 5000 }, // notes recorded after the meeting
    actionItems: [
      new Schema({ text: { type: String, trim: true, maxlength: 300 }, done: { type: Boolean, default: false } }, { _id: true }),
    ],
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);
meetingSchema.index({ project: 1, scheduledAt: -1 });

export const Milestone = mongoose.models.Milestone || mongoose.model('Milestone', milestoneSchema);
export const InteractionLog = mongoose.models.InteractionLog || mongoose.model('InteractionLog', interactionLogSchema);
export const Meeting = mongoose.models.Meeting || mongoose.model('Meeting', meetingSchema);
