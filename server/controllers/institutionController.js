// A coordinator deleting their own institution. (Looking across institutions is the platform admin's job: platformController.js)
import { Institution, User } from '../models/index.js';
import { asyncHandler, ok } from '../utils/helpers.js';
import { AppError } from '../utils/AppError.js';
import { audit } from '../services/audit.js';
import { purgeInstitution } from '../services/institutionPurge.js';
import { clearAuthCookie } from '../middleware/auth.js';
import env from '../config/env.js';

/**
 * POST /institutions/mine/delete { password, confirmName, eraseNow }
 * A coordinator deletes their own institution (for example after trying APMMS and not liking it).
 * Everyone at the institution is blocked immediately. The data is erased for good after INSTITUTION_PURGE_DAYS
 * (a platform admin can restore it before that), or at once when eraseNow is true.
 */
export const deleteMyInstitution = asyncHandler(async (req, res) => {
  const me = await User.findById(req.user._id).select('+passwordHash');
  if (!me || me.role !== 'coordinator') throw new AppError('Only a coordinator can delete the institution.', 403);
  const inst = await Institution.findById(req.user.institution);
  if (!inst) throw new AppError('Institution not found', 404);
  if (String(req.body.confirmName || '').trim().toLowerCase() !== inst.name.trim().toLowerCase()) throw new AppError('Type the institution name exactly to confirm.', 422, { confirmName: 'Does not match the institution name' });
  if (!(await me.checkPassword(req.body.password))) throw new AppError('Your password is not correct.', 422, { password: 'Incorrect password' });

  const eraseNow = req.body.eraseNow === true || env.institutionPurgeDays === 0;
  await audit(req, { action: 'institution.self_deleted', entityType: 'Institution', entityId: inst._id, summary: `${me.name} deleted the institution ${inst.name}${eraseNow ? ' (erased immediately)' : ''}` });
  if (eraseNow) {
    await purgeInstitution(inst._id);
  } else {
    inst.status = 'deleted';
    inst.deletedAt = new Date();
    inst.purgeAt = new Date(Date.now() + env.institutionPurgeDays * 24 * 60 * 60 * 1000);
    inst.statusNote = 'Deleted by its coordinator';
    await inst.save();
  }
  clearAuthCookie(res);
  ok(res, { erased: eraseNow, purgeAt: eraseNow ? null : inst.purgeAt, message: eraseNow ? 'The institution and all its data were erased.' : `The institution was deleted. Its data is erased for good on ${inst.purgeAt.toDateString()}.` });
});
