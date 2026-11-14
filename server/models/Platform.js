// Platform-level records: the website owner's admin accounts, their audit log and global switches.
// These belong to NO institution (tenant:false), so an institution being suspended, deleted or erased
// can never affect them.
import './tenantPlugin.js';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const { Schema } = mongoose;
const BCRYPT_COST = 12;

const adminSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 120 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    isActive: { type: Boolean, default: true },
    isFounder: { type: Boolean, default: false }, // the first admin: other admins cannot switch them off or reset their password
    mustChangePassword: { type: Boolean, default: false },
    tokenVersion: { type: Number, default: 0 }, // bumping it logs out every session of this admin
    lastLoginAt: { type: Date },
    failedLogins: { type: Number, default: 0, select: false },
    lockUntil: { type: Date, select: false },
    createdBy: { type: Schema.Types.ObjectId, ref: 'PlatformAdmin' },
    passwordResetTokenHash: { type: String, select: false },
    passwordResetExpires: { type: Date, select: false },
  },
  { timestamps: true, tenant: false }
);
adminSchema.methods.setPassword = async function setPassword(plain) { this.passwordHash = await bcrypt.hash(plain, BCRYPT_COST); };
adminSchema.methods.checkPassword = function checkPassword(plain) { return this.passwordHash ? bcrypt.compare(plain, this.passwordHash) : Promise.resolve(false); };
adminSchema.set('toJSON', { transform: (_d, ret) => { delete ret.passwordHash; delete ret.failedLogins; delete ret.lockUntil; delete ret.passwordResetTokenHash; delete ret.passwordResetExpires; delete ret.__v; return ret; } });

const platformAuditSchema = new Schema(
  {
    actor: { type: Schema.Types.ObjectId, ref: 'PlatformAdmin' },
    actorName: { type: String },
    action: { type: String, required: true, index: true },
    targetType: { type: String },
    targetId: { type: Schema.Types.ObjectId },
    summary: { type: String, maxlength: 300 },
    ip: { type: String },
  },
  { timestamps: { createdAt: true, updatedAt: false }, tenant: false }
);
platformAuditSchema.index({ createdAt: -1 });

const platformSettingSchema = new Schema(
  { key: { type: String, required: true, unique: true }, value: { type: Schema.Types.Mixed } },
  { timestamps: true, tenant: false }
);

export const PlatformAdmin = mongoose.models.PlatformAdmin || mongoose.model('PlatformAdmin', adminSchema);
export const PlatformAudit = mongoose.models.PlatformAudit || mongoose.model('PlatformAudit', platformAuditSchema);
export const PlatformSetting = mongoose.models.PlatformSetting || mongoose.model('PlatformSetting', platformSettingSchema);
