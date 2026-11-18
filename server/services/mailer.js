import nodemailer from 'nodemailer';
import env from '../config/env.js';

/**
 * Sends email through the SMTP server named in server/.env (SMTP_HOST, SMTP_USER, SMTP_PASS...).
 * No credentials live in the code. With SMTP_HOST empty:
 *   - development: the email text (with its link) is printed on the server console
 *   - production: nothing is printed (links are secrets) and a warning is logged
 *   - tests: messages are kept in `outbox` so tests can read them
 */
export const outbox = [];
let transport;
let warned = false;

function getTransport() {
  if (!env.smtp.host) return null;
  if (!transport) {
    transport = nodemailer.createTransport({
      host: env.smtp.host,
      port: env.smtp.port,
      secure: env.smtp.secure,
      auth: env.smtp.user ? { user: env.smtp.user, pass: env.smtp.pass } : undefined,
    });
  }
  return transport;
}

export const emailConfigured = () => Boolean(env.smtp.host);

/** Returns { sent: boolean }. Never throws: a mail problem must not break registration. */
export async function sendMail({ to, subject, text, html }) {
  const t = getTransport();
  if (!t) {
    if (process.env.NODE_ENV === 'test') outbox.push({ to, subject, text, html });
    else if (!env.isProd) console.log(`\n[email not configured - printed here instead]\nTo: ${to}\nSubject: ${subject}\n${text}\n`);
    else if (!warned) {
      warned = true;
      console.warn('[email] SMTP_HOST is not set, so no emails can be sent. Set the SMTP_* variables (see docs/setup-guide.md).');
    }
    return { sent: false };
  }
  try {
    await t.sendMail({ from: env.emailFrom, to, subject, text, html });
    return { sent: true };
  } catch (err) {
    console.error('[email] sending failed:', err.message);
    return { sent: false, error: true };
  }
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function verificationEmail({ name, link, hours }) {
  const text = `Hello ${name},\n\nWelcome to APMMS. Please confirm your email address by opening this link:\n\n${link}\n\nThe link works for ${hours} hours and can be used once. If you did not create an account, you can ignore this email.\n`;
  const html = `<div style="font-family:Arial,sans-serif;max-width:480px"><h2>Confirm your email</h2><p>Hello ${esc(name)},</p><p>Welcome to APMMS. Please confirm your email address to finish creating your account.</p><p><a href="${esc(link)}" style="background:#2f5bea;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;display:inline-block">Verify my email</a></p><p style="color:#555;font-size:13px">Or copy this link into your browser:<br>${esc(link)}</p><p style="color:#555;font-size:13px">The link works for ${hours} hours and can be used once. If you did not create an account, ignore this email.</p></div>`;
  return { subject: 'Verify your email for APMMS', text, html };
}

export function invitationEmail({ name, institutionName, roleText, link, days, invitedBy, reset }) {
  const subject = reset ? 'Set a new password for APMMS' : `You were invited to ${institutionName} on APMMS`;
  const intro = reset
    ? `The APMMS administrator asked you to choose a new password.`
    : `${invitedBy ? `${invitedBy} added` : 'You were added'} you as ${roleText} of ${institutionName} on APMMS.`;
  const text = `Hello ${name},\n\n${intro}\n\nOpen this link to set your password:\n\n${link}\n\nThe link works for ${days} days and can be used once. After that, log in with your email and the new password.\n`;
  const html = `<div style="font-family:Arial,sans-serif;max-width:480px"><h2>${reset ? 'Choose a new password' : 'Set up your APMMS account'}</h2><p>Hello ${esc(name)},</p><p>${esc(intro)}</p><p><a href="${esc(link)}" style="background:#2f5bea;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;display:inline-block">Set my password</a></p><p style="color:#555;font-size:13px">Or copy this link into your browser:<br>${esc(link)}</p><p style="color:#555;font-size:13px">The link works for ${days} days and can be used once.</p></div>`;
  return { subject, text, html };
}
