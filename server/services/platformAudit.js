import { PlatformAudit } from '../models/index.js';

/** Writes one line to the platform audit log. Never throws (a log problem must not break the action). */
export async function platformAudit(admin, { action, targetType, targetId, summary }, ip) {
  try {
    await PlatformAudit.create({ actor: admin?._id, actorName: admin?.name, action, targetType, targetId, summary, ip });
  } catch (err) {
    console.error('[platform-audit] could not write:', err.message);
  }
}
