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

departmentSchema.index({ institution: 1, name: 1 }, { unique: true });
departmentSchema.index({ institution: 1, code: 1 }, { unique: true });
termSchema.index({ institution: 1, name: 1 }, { unique: true });

export const Department = mongoose.models.Department || mongoose.model('Department', departmentSchema);
export const AcademicTerm = mongoose.models.AcademicTerm || mongoose.model('AcademicTerm', termSchema);
