// Batch and term rules in one place.
// A student belongs to one batch; the batch points at the term it is working in; groups and projects follow that term.
import { AcademicTerm, Batch, User, ProjectGroup, Project } from '../models/index.js';
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

const FINISHED = ['evaluated', 'completed', 'archived'];

/** Puts a whole batch into a term: its students follow and (optionally) its unfinished groups and projects too. */
export async function moveBatchToTerm(batch, term, moveGroups = true) {
  const from = batch.term;
  batch.term = term._id;
  await batch.save();
  await User.updateMany({ batch: batch._id, role: 'student' }, { $set: { term: term._id } });
  let moved = 0;
  let skipped = 0;
  if (moveGroups && String(from) !== String(term._id)) {
    const projects = await Project.find({ batch: batch._id, status: { $nin: FINISHED } }).select('group').lean();
    for (const p of projects) {
      const group = await ProjectGroup.findById(p.group);
      if (!group || group.status !== 'active') continue;
      try {
        group.term = term._id;
        await group.save();
        await Project.updateOne({ _id: p._id }, { $set: { term: term._id } });
        moved += 1;
      } catch (err) {
        if (err.code === 11000) skipped += 1; // another group in that term already has the same name
        else throw err;
      }
    }
  }
  return { moved, skipped };
}
