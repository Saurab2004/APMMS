import { AuditLog } from '../models/index.js';

/**
 * Records an important action. A failure to write the log must never break the user's action,
 * so errors are only printed.
 *  scope "project" = also visible in that project's activity timeline.
 */
export async function audit(req, { action, entityType, entityId, project, scope = 'system', summary, meta }) {
  try {
    await AuditLog.create({
      institution: req?.user?.institution,
      actor: req?.user?._id,
      actorRole: req?.user?.role,
      action,
      entityType,
      entityId,
      project,
      scope,
      summary,
      meta,
      ip: req?.ip,
    });
  } catch (err) {
    console.error('[audit] could not write audit log:', err.message);
  }
}
