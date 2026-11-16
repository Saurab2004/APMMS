// Batch and term rules in one place.
// A student belongs to one batch; the batch points at the term it is working in; groups and projects follow that term.
import { AcademicTerm, Batch } from '../models/index.js';
import { AppError } from '../utils/AppError.js';

/** The batch and term a student's new group goes into. Throws a clear message when something is not set up. */
export async function batchAndTermFor(user) {
  if (user.batch) {
    const batch = await Batch.findById(user.batch);
    if (!batch) throw new AppError('Your batch no longer exists. Please contact the coordinator.', 409);
    if (batch.status === 'completed') throw new AppError(`Your batch "${batch.name}" is marked as completed, so new groups cannot be created. Please contact the coordinator.`, 409);
    if (!batch.term) throw new AppError(`Your batch "${batch.name}" has no academic term yet. Please ask the coordinator to set its term.`, 409);
    const term = await AcademicTerm.findOne({ _id: batch.term, isActive: true });
    if (!term) throw new AppError(`The term of your batch "${batch.name}" is not active. Please contact the coordinator.`, 409);
    return { batch, term };
  }
  // Older accounts without a batch: fall back to the institution's default term, if one is set.
  const term = (user.term && (await AcademicTerm.findOne({ _id: user.term, isActive: true }))) || (await AcademicTerm.findOne({ isCurrent: true, isActive: true }));
  if (!term) throw new AppError('Your account is not linked to a batch yet and no default term is set. Please ask the coordinator to assign your batch.', 409);
  return { batch: null, term };
}

/** Keep a student's term in step with their batch. */
export function syncStudentTerm(user, batch) {
  user.batch = batch?._id;
  if (batch?.term) user.term = batch.term;
}
