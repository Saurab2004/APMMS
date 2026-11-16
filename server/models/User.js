import './tenantPlugin.js';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const { Schema } = mongoose;

export const ROLES = ['student', 'supervisor', 'coordinator', 'evaluator'];
const BCRYPT_COST = process.env.NODE_ENV === 'test' ? 4 : 12;

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 200 },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ROLES, required: true, index: true },
    department: { type: Schema.Types.ObjectId, ref: 'Department' },
    batch: { type: Schema.Types.ObjectId, ref: 'Batch', index: true }, // students: their intake batch
    term: { type: Schema.Types.ObjectId, ref: 'AcademicTerm' }, // students: follows the batch's current term
    studentId: { type: String, trim: true, maxlength: 40 },
    phone: { type: String, trim: true, maxlength: 30 },
    bio: { type: String, trim: true, maxlength: 600 },
    designation: { type: String, trim: true, maxlength: 100 }, // supervisors
    expertise: [{ type: String, trim: true, maxlength: 60 }],
    maxProjects: { type: Number, default: 5, min: 1, max: 50 }, // supervisor capacity
    organization: { type: String, trim: true, maxlength: 150 }, // external evaluators
    isActive: { type: Boolean, default: true, index: true },
    // Supervisor and coordinator self-sign-ups wait here until the coordinator approves them.
    // Pending and rejected users are also isActive:false, so every existing 'active users only' check excludes them.
    approvalStatus: { type: String, enum: ['approved', 'pending', 'rejected'], default: 'approved', index: true },
    approvalNote: { type: String, trim: true, maxlength: 300 },
    mustChangePassword: { type: Boolean, default: false },
    accessExpiresAt: { type: Date }, // used for temporary External Evaluator access
    tokenVersion: { type: Number, default: 0 }, // bump to invalidate every existing login
    passwordResetTokenHash: { type: String, select: false },
    passwordResetExpires: { type: Date, select: false },
    notificationPrefs: {
      chat: { type: Boolean, default: true },
      feedback: { type: Boolean, default: true },
      deadlines: { type: Boolean, default: true },
    },
    lastLoginAt: { type: Date },
    // Email verification. Accounts created before this feature have no value and count as verified (default true).
    emailVerified: { type: Boolean, default: true },
    emailVerifiedAt: { type: Date },
    emailVerification: {
      tokenHash: { type: String, select: false }, // only a hash of the emailed token is stored
      usedHash: { type: String, select: false }, // hash of the last token that worked (to say "already used")
      expiresAt: { type: Date, select: false },
      sentAt: { type: Date, select: false },
      windowStart: { type: Date, select: false },
      sendCount: { type: Number, select: false },
    },
    // Soft deletion (coordinator "Delete my account"): the row stays so projects, evaluations and audit history keep their links.
    deletedAt: { type: Date },
    // Set when the person dismisses or finishes the first-login welcome guide.
    onboardingSeenAt: { type: Date },
  },
  { timestamps: true }
);

userSchema.index({ institution: 1, studentId: 1 }, { unique: true, partialFilterExpression: { studentId: { $type: 'string' } } });
userSchema.index({ role: 1, department: 1, isActive: 1 });

userSchema.methods.setPassword = async function setPassword(plain) {
  this.passwordHash = await bcrypt.hash(plain, BCRYPT_COST);
};

userSchema.methods.checkPassword = function checkPassword(plain) {
  if (!this.passwordHash) return Promise.resolve(false);
  return bcrypt.compare(plain, this.passwordHash);
};

userSchema.set('toJSON', {
  transform: (_doc, ret) => {
    delete ret.passwordHash;
    delete ret.passwordResetTokenHash;
    delete ret.passwordResetExpires;
    delete ret.tokenVersion;
    delete ret.emailVerification;
    delete ret.__v;
    return ret;
  },
});

export const User = mongoose.models.User || mongoose.model('User', userSchema);
