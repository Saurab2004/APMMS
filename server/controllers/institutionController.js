// Platform-owner features: approve / reject / suspend institutions. Everything else in APMMS lives
// inside one institution; this is the only place that looks across institutions.
import { Institution, User } from '../models/index.js';
import { asyncHandler, ok, isId, sameId } from '../utils/helpers.js';
import { AppError } from '../utils/AppError.js';
import { audit } from '../services/audit.js';
import { sendMail } from '../services/mailer.js';
import { runUnscoped } from '../utils/tenant.js';
import { purgeInstitution } from '../services/institutionPurge.js';
import { clearAuthCookie } from '../middleware/auth.js';
import env from '../config/env.js';

export const listInstitutions = asyncHandler(async (req, res) => {
  const filter = {};
  if (['pending', 'approved', 'rejected', 'suspended'].includes(req.query.status)) filter.status = req.query.status;
  const items = await runUnscoped(async () => {
    const list = await Institution.find(filter).sort({ createdAt: -1 }).lean();
    for (const inst of list) {
      inst.coordinators = await User.find({ institution: inst._id, role: 'coordinator', deletedAt: null }).select('name email approvalStatus isActive emailVerified isPlatformOwner').lean();
      inst.counts = {
        students: await User.countDocuments({ institution: inst._id, role: 'student' }),
        supervisors: await User.countDocuments({ institution: inst._id, role: 'supervisor' }),
      };
      inst.isMine = sameId(inst._id, req.user.institution);
    }
    return list;
  });
  ok(res, items);
});

const NEXT = { approve: 'approved', reject: 'rejected', suspend: 'suspended', reactivate: 'approved', restore: 'approved', purge: 'purged' };
const FROM = { approve: ['pending', 'rejected'], reject: ['pending'], suspend: ['approved'], reactivate: ['suspended'], restore: ['deleted'], purge: ['pending', 'approved', 'rejected', 'suspended', 'deleted'] };

export const decideInstitution = asyncHandler(async (req, res) => {
  const { decision, note } = req.body;
  if (!isId(req.params.id)) throw new AppError('Institution not found', 404);
  if (!NEXT[decision]) throw new AppError('Unknown decision', 422);
  const result = await runUnscoped(async () => {
    const inst = await Institution.findById(req.params.id);
    if (!inst) throw new AppError('Institution not found', 404);
    if (sameId(inst._id, req.user.institution)) throw new AppError('You cannot change your own institution here.', 409);
    if (!FROM[decision].includes(inst.status)) throw new AppError(`This institution is ${inst.status}, so it cannot be ${NEXT[decision]} now.`, 409);
    if (decision === 'purge') {
      const result = await purgeInstitution(inst._id);
      return { inst, coordinators: [], purged: result };
    }
    inst.status = NEXT[decision];
    if (decision === 'restore') { inst.deletedAt = undefined; inst.purgeAt = undefined; }
    inst.statusNote = note || undefined;
    inst.decidedAt = new Date();
    inst.decidedBy = req.user._id;
    await inst.save();

    // The coordinator(s) who asked for the institution follow its decision.
    let coordinators = [];
    if (decision === 'approve') {
      coordinators = await User.find({ institution: inst._id, role: 'coordinator', approvalStatus: 'pending', deletedAt: null });
      await User.updateMany({ _id: { $in: coordinators.map((c) => c._id) } }, { $set: { approvalStatus: 'approved', isActive: true } });
    } else if (decision === 'reject') {
      coordinators = await User.find({ institution: inst._id, role: 'coordinator', approvalStatus: 'pending', deletedAt: null });
      await User.updateMany({ _id: { $in: coordinators.map((c) => c._id) } }, { $set: { approvalStatus: 'rejected', approvalNote: note || undefined, isActive: false } });
    }
    return { inst, coordinators };
  });

  for (const c of result.coordinators) {
    const approved = decision === 'approve';
    await sendMail({
      to: c.email,
      subject: approved ? 'Your institution is approved on APMMS' : 'Your institution request on APMMS',
      text: approved
        ? `Hello ${c.name},\n\n${result.inst.name} was approved. You can log in as Coordinator now:\n${env.appUrl}/login\n`
        : `Hello ${c.name},\n\nThe request for ${result.inst.name} was not approved${note ? `: ${note}` : '.'}\n`,
    });
  }
  await audit(req, { action: `institution.${decision}`, entityType: 'Institution', summary: `${decision} institution ${result.inst.name}` });
  ok(res, { institution: result.inst, purged: result.purged });
});

/** Hand the "approves institutions" role to another approved coordinator (so the current owner may leave). */
export const grantPlatformOwner = asyncHandler(async (req, res) => {
  if (!isId(req.body.userId)) throw new AppError('Choose a coordinator', 422);
  await runUnscoped(async () => {
    const u = await User.findOne({ _id: req.body.userId, role: 'coordinator', isActive: true, approvalStatus: 'approved', deletedAt: null });
    if (!u) throw new AppError('That coordinator was not found or is not active', 404);
    u.isPlatformOwner = true;
    await u.save();
    await audit(req, { action: 'platform.owner_granted', entityType: 'User', entityId: u._id, summary: `${u.name} is now a platform owner` });
  });
  ok(res, { message: 'Done. That coordinator can now approve institutions.' });
});

/**
 * POST /institutions/mine/delete { password, confirmName, eraseNow }
 * A coordinator deletes their own institution (for example after trying APMMS and not liking it).
 * Everyone at the institution is blocked immediately. The data is erased for good after INSTITUTION_PURGE_DAYS
 * (the platform owner can restore it before that), or at once when eraseNow is true.
 */
export const deleteMyInstitution = asyncHandler(async (req, res) => {
  const me = await User.findById(req.user._id).select('+passwordHash');
  if (!me || me.role !== 'coordinator') throw new AppError('Only a coordinator can delete the institution.', 403);
  const inst = await Institution.findById(req.user.institution);
  if (!inst) throw new AppError('Institution not found', 404);
  if (String(req.body.confirmName || '').trim().toLowerCase() !== inst.name.trim().toLowerCase()) throw new AppError('Type the institution name exactly to confirm.', 422, { confirmName: 'Does not match the institution name' });
  if (!(await me.checkPassword(req.body.password))) throw new AppError('Your password is not correct.', 422, { password: 'Incorrect password' });

  await runUnscoped(async () => {
    const hasOwner = await User.exists({ institution: inst._id, isPlatformOwner: true });
    if (hasOwner && !(await User.exists({ isPlatformOwner: true, isActive: true, institution: { $ne: inst._id } }))) {
      throw new AppError('This institution holds the platform owner, who approves new institutions. Make a coordinator of another institution the platform owner first.', 409, undefined, 'LAST_PLATFORM_OWNER');
    }
  });

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
