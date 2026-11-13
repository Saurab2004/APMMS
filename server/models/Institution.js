import './tenantPlugin.js';
import mongoose from 'mongoose';

const { Schema } = mongoose;

export const INSTITUTION_TYPES = ['university', 'college', 'school', 'institute', 'training_center', 'other'];
export const INSTITUTION_STATUS = ['pending', 'approved', 'rejected', 'suspended', 'deleted'];

// One institution = one separate workspace (its own users, departments, projects, rubrics, settings).
const institutionSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 160 },
    nameKey: { type: String, required: true, index: true }, // lower-case name, used to stop duplicates
    type: { type: String, enum: INSTITUTION_TYPES, default: 'university' },
    status: { type: String, enum: INSTITUTION_STATUS, default: 'pending', index: true },
    statusNote: { type: String, trim: true, maxlength: 300 },
    decidedAt: { type: Date },
    decidedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    // Self-deletion by the coordinator: blocked at once, erased for good at purgeAt (unless the platform owner restores it).
    deletedAt: { type: Date },
    purgeAt: { type: Date },
  },
  { timestamps: true, tenant: false } // tenant:false = not itself limited to one institution
);

export const Institution = mongoose.models.Institution || mongoose.model('Institution', institutionSchema);
