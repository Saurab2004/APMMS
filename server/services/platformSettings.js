import { PlatformSetting } from '../models/index.js';

export const PLATFORM_DEFAULTS = {
  allowInstitutionRegistration: true, // can a new institution sign itself up on the Register page?
  loginNotice: '', // a short message shown on the login page (e.g. "Maintenance on Sunday 10 pm")
};

export async function getPlatformSettings() {
  const rows = await PlatformSetting.find({ key: { $in: Object.keys(PLATFORM_DEFAULTS) } }).lean();
  const out = { ...PLATFORM_DEFAULTS };
  for (const r of rows) out[r.key] = r.value;
  return out;
}

export async function updatePlatformSettings(patch) {
  const next = {};
  if (typeof patch.allowInstitutionRegistration === 'boolean') next.allowInstitutionRegistration = patch.allowInstitutionRegistration;
  if (typeof patch.loginNotice === 'string') next.loginNotice = patch.loginNotice.trim().slice(0, 240);
  for (const [key, value] of Object.entries(next)) {
    await PlatformSetting.updateOne({ key }, { $set: { value } }, { upsert: true });
  }
  return getPlatformSettings();
}
