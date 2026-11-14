// Loads environment variables ONCE, before any other module reads them.
// Every file that needs configuration imports `env` from here.
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const nodeEnv = process.env.NODE_ENV || 'development';
const isProd = nodeEnv === 'production';

let jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret || jwtSecret.startsWith('replace-this')) {
  if (isProd) {
    throw new Error('JWT_SECRET must be set to a long random value in production.');
  }
  jwtSecret = 'dev-only-insecure-secret-change-me-please-0123456789';
  if (nodeEnv !== 'test') {
    console.warn('[config] JWT_SECRET is not set - using an insecure development secret.');
  }
}

export const env = {
  nodeEnv,
  isProd,
  port: Number(process.env.PORT) || 5000,
  mongoUri: process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/apmms',
  jwtSecret,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '8h',
  cookieName: 'apmms_token',
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  uploadDir: path.resolve(__dirname, '..', process.env.UPLOAD_DIR || 'uploads'),
  maxUploadMB: Number(process.env.MAX_UPLOAD_MB) || 10,
  trustProxy: process.env.TRUST_PROXY === '1',
  // Used once to create the very first coordinator from the Register page. Empty = that option is off.
  // Secret that allows creating the FIRST platform admin on /platform/setup (falls back to the old COORDINATOR_SETUP_CODE name).
  platformSetupCode: (process.env.PLATFORM_SETUP_CODE || process.env.COORDINATOR_SETUP_CODE || '').trim(),
  adminCookieName: 'apmms_admin',
  adminSessionHours: Number(process.env.ADMIN_SESSION_HOURS) || 4,
  // Email (used for the verification email). Leave SMTP_HOST empty to print links on the server console instead (development only).
  appUrl: (process.env.APP_URL || process.env.CLIENT_ORIGIN || 'http://localhost:5173').replace(/\/+$/, ''),
  emailFrom: process.env.EMAIL_FROM || 'APMMS <no-reply@localhost>',
  smtp: {
    host: (process.env.SMTP_HOST || '').trim(),
    port: Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
  },
  institutionPurgeDays: process.env.INSTITUTION_PURGE_DAYS ? Math.max(0, Number(process.env.INSTITUTION_PURGE_DAYS) || 0) : 14,
  emailVerifyHours: Number(process.env.EMAIL_VERIFY_HOURS) || 24,
};

export default env;
