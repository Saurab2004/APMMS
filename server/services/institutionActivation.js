import { Institution } from '../models/index.js';
import { audit } from './audit.js';

/**
 * A coordinator who registered a NEW institution gets that institution (and their own account) activated
 * by verifying their email: no other institution and no admin has to approve it.
 * (The platform admin can still suspend or reject it.) Returns true when something was activated.
 */
export async function activateNewInstitution(user, ip) {
  if (user.role !== 'coordinator' || user.approvalStatus !== 'pending' || !user.institution) return false;
  const inst = await Institution.findOneAndUpdate({ _id: user.institution, status: 'pending' }, { $set: { status: 'approved', decidedAt: new Date(), statusNote: 'Activated after email verification' } });
  if (!inst) return false;
  user.approvalStatus = 'approved';
  user.isActive = true;
  await user.save();
  await audit({ user, ip }, { action: 'institution.auto_activated', entityType: 'Institution', entityId: inst._id, summary: `${inst.name} was activated after its coordinator verified their email` });
  return true;
}
