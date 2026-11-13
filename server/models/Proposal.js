import './tenantPlugin.js';
import mongoose from 'mongoose';
import { PROPOSAL_STATUS, REVIEW_DECISIONS } from '../utils/workflow.js';
import { fileSchema } from './shared.js';

const { Schema } = mongoose;

const proposalSchema = new Schema(
  {
    project: { type: Schema.Types.ObjectId, ref: 'Project', required: true, unique: true },
    status: { type: String, enum: PROPOSAL_STATUS, default: 'draft', index: true },
    currentVersion: { type: Number, default: 1 }, // number of the newest version (draft or submitted)
    approvedVersion: { type: Number },
    submittedAt: { type: Date }, // most recent submission
    decidedAt: { type: Date },
  },
  { timestamps: true }
);

// Every submission is a separate document so history is never overwritten.
const versionSchema = new Schema(
  {
    proposal: { type: Schema.Types.ObjectId, ref: 'Proposal', required: true },
    project: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    version: { type: Number, required: true },
    state: { type: String, enum: ['draft', 'submitted'], default: 'draft' },
    title: { type: String, trim: true, maxlength: 200 },
    abstract: { type: String, trim: true, maxlength: 4000 },
    problemStatement: { type: String, trim: true, maxlength: 4000 },
    objectives: { type: String, trim: true, maxlength: 4000 },
    methodology: { type: String, trim: true, maxlength: 4000 },
    expectedOutcomes: { type: String, trim: true, maxlength: 4000 },
    technologyStack: [{ type: String, trim: true, maxlength: 60 }],
    attachments: { type: [fileSchema], default: [] },
    submittedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    submittedAt: { type: Date },
    review: {
      decision: { type: String, enum: REVIEW_DECISIONS },
      comments: { type: String, trim: true, maxlength: 4000 },
      reviewer: { type: Schema.Types.ObjectId, ref: 'User' },
      reviewedAt: { type: Date },
    },
  },
  { timestamps: true }
);
versionSchema.index({ proposal: 1, version: 1 }, { unique: true });

export const Proposal = mongoose.models.Proposal || mongoose.model('Proposal', proposalSchema);
export const ProposalVersion = mongoose.models.ProposalVersion || mongoose.model('ProposalVersion', versionSchema);
