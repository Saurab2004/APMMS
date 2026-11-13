import './tenantPlugin.js';
import mongoose from 'mongoose';

const { Schema } = mongoose;

const criterionSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, trim: true, maxlength: 300 },
    maxMarks: { type: Number, required: true, min: 1, max: 1000 },
    weight: { type: Number, required: true, min: 0, max: 100, default: 1 },
  },
  { _id: true }
);

const rubricSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    stage: { type: String, required: true, trim: true, maxlength: 60 }, // e.g. "Final defence"
    description: { type: String, trim: true, maxlength: 500 },
    criteria: {
      type: [criterionSchema],
      validate: [(v) => v.length >= 1 && v.length <= 30, 'A rubric needs between 1 and 30 criteria'],
    },
    appliesTo: [{ type: String, enum: ['supervisor', 'external'] }],
    gradingRules: {
      aggregation: { type: String, enum: ['none', 'average'], default: 'none' },
      bands: [new Schema({ min: { type: Number, min: 0, max: 100 }, grade: { type: String, maxlength: 6 } }, { _id: false })],
    },
    isActive: { type: Boolean, default: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

const evaluationSchema = new Schema(
  {
    project: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    rubric: { type: Schema.Types.ObjectId, ref: 'EvaluationRubric', required: true },
    evaluator: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    evaluatorType: { type: String, enum: ['supervisor', 'external'], required: true },
    scores: [
      new Schema(
        {
          criterionId: { type: Schema.Types.ObjectId, required: true },
          marks: { type: Number, required: true, min: 0 },
          comment: { type: String, maxlength: 1000 },
        },
        { _id: false }
      ),
    ],
    remarks: { type: String, trim: true, maxlength: 3000 },
    total: { type: Number, default: 0 },
    maxTotal: { type: Number, default: 0 },
    percentage: { type: Number, default: 0 },
    status: { type: String, enum: ['draft', 'submitted'], default: 'draft' },
    submittedAt: { type: Date },
    reopenCount: { type: Number, default: 0 },
    reopenReason: { type: String, maxlength: 500 },
  },
  { timestamps: true }
);
// Each evaluator can have only one evaluation per project and rubric
evaluationSchema.index({ project: 1, rubric: 1, evaluator: 1 }, { unique: true });

const assignmentSchema = new Schema(
  {
    evaluator: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    rubric: { type: Schema.Types.ObjectId, ref: 'EvaluationRubric', required: true },
    projects: [{ type: Schema.Types.ObjectId, ref: 'Project' }],
    sessionLabel: { type: String, trim: true, maxlength: 120 },
    expiresAt: { type: Date, required: true },
    status: { type: String, enum: ['active', 'revoked'], default: 'active' },
    revokedAt: { type: Date },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);
assignmentSchema.index({ projects: 1, status: 1 });

export const EvaluationRubric = mongoose.models.EvaluationRubric || mongoose.model('EvaluationRubric', rubricSchema);
export const Evaluation = mongoose.models.Evaluation || mongoose.model('Evaluation', evaluationSchema);
export const ExternalEvaluatorAssignment =
  mongoose.models.ExternalEvaluatorAssignment || mongoose.model('ExternalEvaluatorAssignment', assignmentSchema);
