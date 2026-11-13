import crypto from 'crypto';
import env from '../config/env.js';
import { User } from '../models/index.js';
import { sha256 } from '../utils/helpers.js';
import { sendMail, verificationEmail } from './mailer.js';

export const RESEND_COOLDOWN_MS = 60 * 1000; // one email per minute per account
export const MAX_SENDS_PER_HOUR = 5;
const HOUR = 60 * 60 * 1000;

/**
 * Creates a fresh token for the user, stores only its hash, and emails the link.
 * Returns { sent, limited }. `limited` means the cooldown or hourly cap stopped it.
 * `user` must be loaded WITH the emailVerification fields selected.
 */
export async function issueVerificationEmail(user) {
  const now = Date.now();
  const ev = user.emailVerification || {};
  if (ev.sentAt && now - new Date(ev.sentAt).getTime() < RESEND_COOLDOWN_MS) return { sent: false, limited: true };
  const windowStart = ev.windowStart && now - new Date(ev.windowStart).getTime() < HOUR ? new Date(ev.windowStart) : new Date(now);
  const sendCount = windowStart.getTime() === new Date(ev.windowStart || 0).getTime() ? (ev.sendCount || 0) : 0;
  if (sendCount >= MAX_SENDS_PER_HOUR) return { sent: false, limited: true };

  const token = crypto.randomBytes(32).toString('hex');
  user.emailVerification = {
    tokenHash: sha256(token),
    usedHash: ev.usedHash,
    expiresAt: new Date(now + env.emailVerifyHours * HOUR),
    sentAt: new Date(now),
    windowStart,
    sendCount: sendCount + 1,
  };
  await user.save();
  const link = `${env.appUrl}/verify-email?token=${token}`;
  const mail = verificationEmail({ name: user.name, link, hours: env.emailVerifyHours });
  const result = await sendMail({ to: user.email, ...mail });
  return { sent: result.sent, limited: false };
}

export const findForVerification = (filter) =>
  User.findOne(filter).select('+emailVerification.tokenHash +emailVerification.usedHash +emailVerification.expiresAt +emailVerification.sentAt +emailVerification.windowStart +emailVerification.sendCount');
