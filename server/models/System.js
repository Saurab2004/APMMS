import './tenantPlugin.js';
import mongoose from 'mongoose';
import { fileSchema } from './shared.js';

const { Schema } = mongoose;

const settingSchema = new Schema(
  {
    key: { type: String, required: true },
    value: { type: Schema.Types.Mixed },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

settingSchema.index({ institution: 1, key: 1 }, { unique: true });

const auditSchema = new Schema(
  {
    actor: { type: Schema.Types.ObjectId, ref: 'User' },
    actorRole: { type: String },
    action: { type: String, required: true, index: true }, // e.g. "proposal.approved"
    entityType: { type: String },
    entityId: { type: Schema.Types.ObjectId },
    project: { type: Schema.Types.ObjectId, ref: 'Project' },
    // "project" entries can be shown to the project's own students/supervisor in the timeline
    scope: { type: String, enum: ['system', 'project'], default: 'system' },
    summary: { type: String, maxlength: 300 },
    meta: { type: Schema.Types.Mixed },
    ip: { type: String },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);
auditSchema.index({ createdAt: -1 });
auditSchema.index({ project: 1, scope: 1, createdAt: -1 });

const repositorySchema = new Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 160 },
    description: { type: String, trim: true, maxlength: 1000 },
    category: { type: String, enum: ['template', 'guideline', 'rubric', 'sample', 'other'], default: 'other' },
    visibility: { type: String, enum: ['all', 'students', 'supervisors'], default: 'all' },
    department: { type: Schema.Types.ObjectId, ref: 'Department' }, // empty = every department
    file: { type: fileSchema, required: true },
    uploadedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    isArchived: { type: Boolean, default: false },
  },
  { timestamps: true }
);
repositorySchema.index({ isArchived: 1, category: 1 });

export const SystemSetting = mongoose.models.SystemSetting || mongoose.model('SystemSetting', settingSchema);
export const AuditLog = mongoose.models.AuditLog || mongoose.model('AuditLog', auditSchema);
export const RepositoryResource = mongoose.models.RepositoryResource || mongoose.model('RepositoryResource', repositorySchema);
