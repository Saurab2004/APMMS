import './tenantPlugin.js';
import mongoose from 'mongoose';

const { Schema } = mongoose;

const departmentSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    code: { type: String, required: true, trim: true, uppercase: true, maxlength: 12 },
    description: { type: String, trim: true, maxlength: 500 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

const termSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 }, // e.g. "Fall 2026"
    academicYear: { type: String, required: true, trim: true, maxlength: 20 }, // e.g. "2026-2027"
    semester: { type: String, required: true, trim: true, maxlength: 30 }, // e.g. "Fall"
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    isCurrent: { type: Boolean, default: false, index: true },
    isActive: { type: Boolean, default: true },
    // Deadlines configured by the Coordinator for this term
    deadlines: {
      proposal: { type: Date },
      finalReport: { type: Date },
    },
  },
  { timestamps: true }
);

// A batch is one intake of one department (for example "2023 Batch" of Computer Science).
// It points at the term it is working in right now, so moving a whole batch to the next semester is one change.
const batchSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 }, // e.g. "2023 Batch"
    department: { type: Schema.Types.ObjectId, ref: 'Department', required: true, index: true },
    intakeYear: { type: Number, min: 1990, max: 2100 },
    term: { type: Schema.Types.ObjectId, ref: 'AcademicTerm' }, // the term this batch is in now
    status: { type: String, enum: ['active', 'completed'], default: 'active', index: true },
    allowSignup: { type: Boolean, default: true }, // students may pick this batch when they register
    note: { type: String, trim: true, maxlength: 300 },
  },
  { timestamps: true }
);
batchSchema.index({ institution: 1, department: 1, name: 1 }, { unique: true });

departmentSchema.index({ institution: 1, name: 1 }, { unique: true });
departmentSchema.index({ institution: 1, code: 1 }, { unique: true });
termSchema.index({ institution: 1, name: 1 }, { unique: true });

export const Department = mongoose.models.Department || mongoose.model('Department', departmentSchema);
export const Batch = mongoose.models.Batch || mongoose.model('Batch', batchSchema);
export const AcademicTerm = mongoose.models.AcademicTerm || mongoose.model('AcademicTerm', termSchema);
