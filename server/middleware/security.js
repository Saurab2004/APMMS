import rateLimit from 'express-rate-limit';
import { AppError } from '../utils/AppError.js';

/**
 * Simple CSRF defence for cookie authentication.
 * Browsers cannot add a custom header on a cross-site form post, and our CORS policy
 * only allows our own frontend to send it. So every state-changing request must carry it.
 * (Postman: add header  X-Requested-With: APMMS )
 */
export function csrfGuard(req, _res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('x-requested-with') !== 'APMMS') {
    return next(new AppError('Missing X-Requested-With header (CSRF protection)', 403));
  }
  next();
}

const limiterMessage = (message) => (_req, res) =>
  res.status(429).json({ success: false, message });

const skipInTests = () => process.env.NODE_ENV === 'test' && process.env.APMMS_TEST_RATELIMIT !== '1';

export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 600,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTests,
  handler: limiterMessage('Too many requests. Please slow down.'),
});

export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTests,
  handler: limiterMessage('Too many login attempts. Try again in 15 minutes.'),
});

export const sensitiveLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTests,
  handler: limiterMessage('Too many attempts. Try again later.'),
});

// Email verification gets its own limits so it does not use up the shared sign-up / password-reset allowance.
// (Each account is also limited separately: 1 email per minute, 5 per hour - see services/emailVerification.js.)
export const verifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 40,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTests,
  handler: limiterMessage('Too many verification attempts. Try again in a few minutes.'),
});

export const resendLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTests,
  handler: limiterMessage('Too many email requests from this network. Try again later.'),
});
