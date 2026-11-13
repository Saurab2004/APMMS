import crypto from 'crypto';
import mongoose from 'mongoose';
import { runInInstitution } from './tenant.js';

/**
 * Wraps a route handler: forwards errors, and runs the handler "inside" the logged-in user's institution so every
 * query it makes is limited to that institution (see utils/tenant.js). Public routes have no user, so no limit.
 */
export const asyncHandler = (fn) => (req, res, next) => {
  const run = () => Promise.resolve(fn(req, res, next)).catch(next);
  return req.user?.institution ? runInInstitution(req.user.institution, run) : run();
};

/** Standard success response: { success: true, data, meta? } */
export const ok = (res, data, status = 200, meta) =>
  res.status(status).json({ success: true, data, ...(meta ? { meta } : {}) });

/** Reads ?page=&limit= safely. */
export function parsePage(query, { defaultLimit = 20, maxLimit = 100 } = {}) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(maxLimit, Math.max(1, parseInt(query.limit, 10) || defaultLimit));
  return { page, limit, skip: (page - 1) * limit };
}

export const pageMeta = (page, limit, total) => ({
  page,
  limit,
  total,
  pages: Math.max(1, Math.ceil(total / limit)),
});

/** Builds a Mongo sort object from ?sort=field&dir=asc|desc using an allow-list. */
export function parseSort(query, allowed, fallback = { createdAt: -1 }) {
  if (query.sort && allowed.includes(query.sort)) {
    return { [query.sort]: query.dir === 'asc' ? 1 : -1 };
  }
  return fallback;
}

export const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const isId = (v) => mongoose.isValidObjectId(v) && String(v).length === 24;

/** String form of an ObjectId whether the field is populated or not. */
export const idStr = (v) => (v == null ? '' : String(v._id ?? v));

export const sameId = (a, b) => idStr(a) !== '' && idStr(a) === idStr(b);

export const oid = (v) => new mongoose.Types.ObjectId(String(v));

const PW_LETTERS = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';
const PW_DIGITS = '23456789';

/** Random temporary password that always satisfies the password policy. */
export function generateTempPassword(length = 12) {
  const all = PW_LETTERS + PW_DIGITS;
  const chars = [
    PW_LETTERS[crypto.randomInt(PW_LETTERS.length)],
    PW_DIGITS[crypto.randomInt(PW_DIGITS.length)],
  ];
  while (chars.length < length) chars.push(all[crypto.randomInt(all.length)]);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

export const passwordProblem = (pw) => {
  if (typeof pw !== 'string' || pw.length < 8) return 'Password must be at least 8 characters';
  if (pw.length > 100) return 'Password is too long';
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return 'Password must contain at least one letter and one number';
  return null;
};

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function generateGroupCode(length = 6) {
  let out = '';
  for (let i = 0; i < length; i++) out += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  return out;
}

export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

export const startOfDay = (d = new Date()) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

export const addDays = (d, n) => new Date(new Date(d).getTime() + n * 86400000);
