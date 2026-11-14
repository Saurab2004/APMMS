// Authentication for the Platform Admin console. It is completely separate from the normal login:
//  - its own account collection (PlatformAdmin), its own cookie (HttpOnly, SameSite=Strict, sent only to /api/platform),
//  - no institution, so no institution status can ever lock an admin out,
//  - a normal institution user (even a coordinator) can never pass this check, and an admin has no institution role.
import jwt from 'jsonwebtoken';
import env from '../config/env.js';
import { PlatformAdmin } from '../models/index.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler } from '../utils/helpers.js';

const maxAgeMs = () => env.adminSessionHours * 3600 * 1000;
export const adminCookieOptions = () => ({ httpOnly: true, sameSite: 'strict', secure: env.isProd, path: '/api/platform', maxAge: maxAgeMs() });

export const signAdminToken = (admin) => jwt.sign({ sub: String(admin._id), tv: admin.tokenVersion || 0, kind: 'platform' }, env.jwtSecret, { expiresIn: `${env.adminSessionHours}h` });
export const setAdminCookie = (res, admin) => res.cookie(env.adminCookieName, signAdminToken(admin), adminCookieOptions());
export const clearAdminCookie = (res) => res.clearCookie(env.adminCookieName, { ...adminCookieOptions(), maxAge: undefined });

export async function adminFromToken(token) {
  if (!token) throw new AppError('Please log in to continue', 401);
  let payload;
  try { payload = jwt.verify(token, env.jwtSecret); } catch { throw new AppError('Your session has expired. Please log in again.', 401); }
  if (payload.kind !== 'platform') throw new AppError('Your session is no longer valid', 401);
  const admin = await PlatformAdmin.findById(payload.sub);
  if (!admin || (admin.tokenVersion || 0) !== payload.tv) throw new AppError('Your session is no longer valid. Please log in again.', 401);
  if (!admin.isActive) throw new AppError('This admin account has been deactivated', 403);
  return admin;
}

const PASSWORD_CHANGE_ALLOWED = ['/api/platform/auth/me', '/api/platform/auth/change-password', '/api/platform/auth/logout'];

export const platformAuthenticate = asyncHandler(async (req, _res, next) => {
  req.admin = await adminFromToken(req.cookies?.[env.adminCookieName]);
  if (req.admin.mustChangePassword && !PASSWORD_CHANGE_ALLOWED.includes(req.originalUrl.split('?')[0])) {
    throw new AppError('You must change your temporary password first', 403, undefined, 'PASSWORD_CHANGE_REQUIRED');
  }
  next();
});
