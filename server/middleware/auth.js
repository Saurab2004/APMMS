import jwt from 'jsonwebtoken';
import env from '../config/env.js';
import { User, Institution } from '../models/index.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler } from '../utils/helpers.js';

export const signToken = (user) =>
  jwt.sign({ sub: String(user._id), tv: user.tokenVersion || 0 }, env.jwtSecret, { expiresIn: env.jwtExpiresIn });

const maxAgeMs = () => {
  const m = String(env.jwtExpiresIn).match(/^(\d+)([smhd])$/);
  if (!m) return 8 * 3600 * 1000;
  return Number(m[1]) * { s: 1000, m: 60000, h: 3600000, d: 86400000 }[m[2]];
};

export const cookieOptions = () => ({
  httpOnly: true, // JavaScript in the browser cannot read this cookie
  sameSite: 'lax',
  secure: env.isProd, // HTTPS only in production
  path: '/',
  maxAge: maxAgeMs(),
});

export const setAuthCookie = (res, user) => res.cookie(env.cookieName, signToken(user), cookieOptions());
export const clearAuthCookie = (res) => res.clearCookie(env.cookieName, { ...cookieOptions(), maxAge: undefined });

/** Reads the JWT from a raw Cookie header (used by Socket.IO too). */
export function tokenFromCookieHeader(header = '') {
  const part = header.split(';').map((s) => s.trim()).find((s) => s.startsWith(`${env.cookieName}=`));
  return part ? decodeURIComponent(part.slice(env.cookieName.length + 1)) : null;
}

/** Verifies a token and returns the active user, or throws AppError(401/403). */
export async function userFromToken(token) {
  if (!token) throw new AppError('Please log in to continue', 401);
  let payload;
  try {
    payload = jwt.verify(token, env.jwtSecret);
  } catch {
    throw new AppError('Your session has expired. Please log in again.', 401);
  }
  const user = await User.findById(payload.sub);
  if (!user) throw new AppError('Your session is no longer valid', 401);
  if ((user.tokenVersion || 0) !== payload.tv) throw new AppError('Your session is no longer valid. Please log in again.', 401);
  if (user.approvalStatus === 'pending' || user.approvalStatus === 'rejected') throw new AppError('This account is not approved yet', 403);
  if (!user.isActive) throw new AppError('This account has been deactivated', 403);
  if (user.accessExpiresAt && user.accessExpiresAt < new Date()) throw new AppError('Your access has expired', 403);
  await assertInstitutionUsable(user);
  return user;
}

/** Every account belongs to one institution, and that institution must be approved and not suspended. */
export async function assertInstitutionUsable(user) {
  if (!user.institution) throw new AppError('This account is not linked to an institution yet. Ask the APMMS administrator.', 403);
  const inst = await Institution.findById(user.institution).select('status name').lean();
  if (!inst || inst.status === 'pending') throw new AppError('Your institution is not active yet. Its coordinator must verify their email first.', 403, undefined, 'INSTITUTION_PENDING');
  if (inst.status === 'deleted') throw new AppError(`${inst.name} was deleted by its coordinator.`, 403, undefined, 'INSTITUTION_DELETED');
  if (inst.status !== 'approved') throw new AppError(`Access for ${inst.name} is switched off (${inst.status}). Please contact the platform administrator.`, 403, undefined, 'INSTITUTION_BLOCKED');
}

const PASSWORD_CHANGE_ALLOWED = ['/api/auth/me', '/api/auth/change-password', '/api/auth/logout'];

/** The department a department-level coordinator is limited to; null for everyone else (institution coordinators see all departments). */
export const deptScopeOf = (user) => (user?.role === 'coordinator' && user.coordinatorLevel === 'department' ? user.department : null);

export const authenticate = asyncHandler(async (req, _res, next) => {
  req.user = await userFromToken(req.cookies?.[env.cookieName]);
  req.deptScope = deptScopeOf(req.user);
  if (req.user.mustChangePassword && !PASSWORD_CHANGE_ALLOWED.includes(req.originalUrl.split('?')[0])) {
    throw new AppError('You must change your temporary password first', 403, undefined, 'PASSWORD_CHANGE_REQUIRED');
  }
  next();
});

/** For things that affect the whole institution (terms, faculties, departments, settings): department coordinators may not. */
export const institutionLevelOnly = (req, _res, next) => {
  if (req.deptScope) return next(new AppError('Only the institution coordinator can do this. Ask them, or the platform admin.', 403));
  next();
};

/** Role-based access control. Use after `authenticate`. */
export const authorize = (...roles) => (req, _res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return next(new AppError('You do not have permission to perform this action', 403));
  }
  next();
};
