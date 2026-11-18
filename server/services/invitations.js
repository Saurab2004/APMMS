// Coordinators are never created by self sign-up. They are invited by email: the invited person receives a
// one-time link, chooses a password, and that also proves the email address belongs to them.
import crypto from 'crypto';
import env from '../config/env.js';
import { User, PlatformAdmin, Department } from '../models/index.js';
import { AppError } from '../utils/AppError.js';
import { sendMail, invitationEmail } from './mailer.js';

export const INVITE_DAYS = 7;
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

/** Gives the account a fresh set-password link and emails it. `link` is returned only when the email could not be sent, so an admin can pass it on. */
export async function issueSetPasswordLink(user, { institutionName, roleText, invitedBy, reset = false }) {
  const token = crypto.randomBytes(32).toString('hex');
  user.passwordResetTokenHash = sha256(token);
  user.passwordResetExpires = new Date(Date.now() + INVITE_DAYS * 24 * 3600 * 1000);
  if (!reset) { user.invitePending = true; user.invitedAt = new Date(); }
  await user.save();
  const link = `${env.appUrl}/reset-password?token=${token}${reset ? '' : '&invite=1'}`;
  const mail = invitationEmail({ name: user.name, institutionName, roleText, link, days: INVITE_DAYS, invitedBy, reset });
  const sent = await sendMail({ to: user.email, ...mail });
  if (!sent.sent && env.nodeEnv !== 'test' && !env.isProd) console.log(`[invitation] ${user.email}: ${link}`);
  return { sent: sent.sent, link: sent.sent ? undefined : link };
}

export const roleText = (user, department) => (user.coordinatorLevel === 'department' ? `the coordinator of ${department?.name || 'a department'}` : 'a coordinator');

/**
 * Creates a coordinator account (without a usable password) and emails the invitation.
 * level 'institution': manages the whole institution. level 'department': manages one department only (one per department).
 */
export async function inviteCoordinator({ institution, name, email, level, departmentId, invitedBy }) {
  const mail = String(email).trim().toLowerCase();
  if ((await User.exists({ email: mail })) || (await PlatformAdmin.exists({ email: mail }))) throw new AppError('This email is already used by another account', 409, { email: 'Already used' });
  let department = null;
  if (level === 'department') {
    department = await Department.findOne({ _id: departmentId, institution: institution._id });
    if (!department) throw new AppError('Choose a department of this institution', 422, { departmentId: 'Not found' });
    if (await User.exists({ institution: institution._id, role: 'coordinator', coordinatorLevel: 'department', department: department._id, isActive: true, deletedAt: null })) {
      throw new AppError(`${department.name} already has a coordinator. Deactivate that coordinator first to invite another one.`, 409, { departmentId: 'Already has a coordinator' });
    }
  }
  const user = new User({
    name: String(name).trim(), email: mail, role: 'coordinator', coordinatorLevel: level, institution: institution._id,
    department: department?._id, approvalStatus: 'approved', isActive: true, emailVerified: false, invitePending: true, invitedAt: new Date(),
  });
  await user.setPassword(crypto.randomBytes(24).toString('hex')); // nobody knows it; the link sets the real one
  await user.save();
  const result = await issueSetPasswordLink(user, { institutionName: institution.name, roleText: roleText(user, department), invitedBy });
  return { user, ...result };
}
