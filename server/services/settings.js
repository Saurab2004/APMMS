import { SystemSetting } from '../models/index.js';
import { AppError } from '../utils/AppError.js';

/** Academic rules the Coordinator can change. Nothing semester-specific is hard-coded elsewhere. */
export const SETTING_RULES = {
  maxGroupSize: { type: 'int', min: 1, max: 12, default: 4, label: 'Maximum group size' },
  minGroupSize: { type: 'int', min: 1, max: 12, default: 1, label: 'Minimum group size to submit a proposal' },
  singleActiveGroup: { type: 'bool', default: true, label: 'A student may belong to only one active group' },
  allowSelfRegistration: { type: 'bool', default: true, label: 'Allow students to self-register' },
  invitationExpiryDays: { type: 'int', min: 1, max: 60, default: 7, label: 'Group invitation validity (days)' },
  minApprovedProgressReportsForFinal: { type: 'int', min: 0, max: 50, default: 1, label: 'Approved progress reports required before the final report' },
  reminderLeadDays: { type: 'int', min: 1, max: 30, default: 3, label: 'Send deadline reminders this many days ahead' },
};

export const DEFAULT_SETTINGS = Object.fromEntries(Object.entries(SETTING_RULES).map(([k, r]) => [k, r.default]));

/** Settings of one institution. Inside a logged-in request the institution is implied; public code passes it explicitly. */
export async function getSettings(institutionId) {
  const filter = { key: { $in: Object.keys(SETTING_RULES) } };
  if (institutionId) filter.institution = institutionId;
  const rows = await SystemSetting.find(filter).lean();
  const out = { ...DEFAULT_SETTINGS };
  for (const r of rows) out[r.key] = r.value;
  return out;
}

export function coerceSetting(key, raw) {
  const rule = SETTING_RULES[key];
  if (!rule) throw new AppError(`Unknown setting "${key}"`, 422);
  if (rule.type === 'bool') {
    if (raw === true || raw === 'true') return true;
    if (raw === false || raw === 'false') return false;
    throw new AppError(`${rule.label} must be true or false`, 422);
  }
  const n = Number(raw);
  if (!Number.isInteger(n) || n < rule.min || n > rule.max) {
    throw new AppError(`${rule.label} must be a whole number between ${rule.min} and ${rule.max}`, 422);
  }
  return n;
}

export async function updateSettings(patch, userId) {
  const clean = {};
  for (const [k, v] of Object.entries(patch || {})) clean[k] = coerceSetting(k, v);
  await Promise.all(
    Object.entries(clean).map(([key, value]) =>
      SystemSetting.updateOne({ key }, { $set: { value, updatedBy: userId } }, { upsert: true })
    )
  );
  return getSettings();
}
