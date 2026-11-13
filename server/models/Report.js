import './tenantPlugin.js';
import mongoose from 'mongoose';
import { REPORT_STATUS, REVIEW_DECISIONS } from '../utils/workflow.js';
import { fileSchema } from './shared.js';

const { Schema } = mongoose;

export const REPORT_TYPES = ['weekly', 'biweekly', 'monthly', 'milestone', 'midterm', 'final'];

const reportSchema = new Schema(
  {
    project: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    kind: { type: String, enum: ['progress', 'final'], default: 'progress', index: true },
    type: { type: String, enum: REPORT_TYPES, default: 'weekly' },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, trim: true, maxlength: 3000 },
    periodStart: { type: Date },
    periodEnd: { type: Date },
    milestone: { type: Schema.Types.ObjectId, ref: 'Milestone' },
    deadline: { type: Date }, // copied when the report is created so later changes do not rewrite history
    status: { type: String, enum: REPORT_STATUS, default: 'draft', index: true },
    currentVersion: { type: Number, default: 1 },
    submittedAt: { type: Date }, // latest submission time
    isLate: { type: Boolean, default: false },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);
reportSchema.index({ project: 1, status: 1 });
reportSchema.index({ status: 1, submittedAt: -1 });

// One document per uploaded version (not an array inside the report).
const versionSchema = new Schema(
  {
    report: { type: Schema.Types.ObjectId, ref: 'ProgressReport', required: true },
    project: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    version: { type: Number, required: true },
    state: { type: String, enum: ['draft', 'submitted'], default: 'draft' },
    file: { type: fileSchema },
    attachments: { type: [fileSchema], default: [] },
    note: { type: String, trim: true, maxlength: 2000 }, // student's note, e.g. what changed
    submittedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    submittedAt: { type: Date },
    isLate: { type: Boolean, default: false },
  },
  { timestamps: true }
);
versionSchema.index({ report: 1, version: 1 }, { unique: true });

const reviewSchema = new Schema(
  {
    report: { type: Schema.Types.ObjectId, ref: 'ProgressReport', required: true, index: true },
    project: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    version: { type: Number, required: true },
    reviewer: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    decision: { type: String, enum: REVIEW_DECISIONS, required: true },
    comments: { type: String, trim: true, maxlength: 4000 },
  },
  { timestamps: true }
);

export const ProgressReport = mongoose.models.ProgressReport || mongoose.model('ProgressReport', reportSchema);
export const ReportVersion = mongoose.models.ReportVersion || mongoose.model('ReportVersion', versionSchema);
export const ReportReview = mongoose.models.ReportReview || mongoose.model('ReportReview', reviewSchema);
