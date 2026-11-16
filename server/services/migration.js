// One-time, safe upgrade of a database that was created before institutions existed.
// Runs when the server starts. It is idempotent (does nothing when everything already has an institution)
// and it never deletes anything:
//   1. old "unique across everything" indexes are replaced by "unique inside one institution" ones
//   2. records without an institution are moved into ONE institution named "Default Institution"
//      (change the name later in the database if you like) so existing users keep seeing their data
//   3. students and groups without a batch are put into one batch per department called "Existing students"
//      (rename it later; the coordinator can then move students into proper batches)
//   4. institutions still "pending" whose coordinator has verified the email are activated
import mongoose from 'mongoose';
import { Institution, User, Department, AcademicTerm, Batch, ProjectGroup, Project } from '../models/index.js';
import { runUnscoped } from '../utils/tenant.js';

const LEGACY_INDEXES = [
  ['departments', 'name_1'], ['departments', 'code_1'], ['academicterms', 'name_1'], ['users', 'studentId_1'], ['systemsettings', 'key_1'],
];

export async function migrateToInstitutions({ log = console.log } = {}) {
  return runUnscoped(async () => {
    for (const [coll, name] of LEGACY_INDEXES) {
      try { await mongoose.connection.collection(coll).dropIndex(name); log(`[migrate] dropped old index ${coll}.${name}`); } catch { /* not there: fine */ }
    }

    const scoped = mongoose.modelNames().map((n) => mongoose.model(n)).filter((M) => M.schema.options.tenant !== false);
    let needs = false;
    for (const M of scoped) {
      if (await M.collection.findOne({ institution: { $exists: false } }, { projection: { _id: 1 } })) { needs = true; break; }
    }
    if (needs) {
      let inst = await Institution.findOne({ nameKey: 'default institution' });
      if (!inst) inst = await Institution.create({ name: 'Default Institution', nameKey: 'default institution', type: 'university', status: 'approved', decidedAt: new Date() });
      let moved = 0;
      for (const M of scoped) {
        const r = await M.collection.updateMany({ institution: { $exists: false } }, { $set: { institution: inst._id } });
        moved += r.modifiedCount || 0;
      }
      log(`[migrate] moved ${moved} existing records into "${inst.name}"`);
    }

    // The old "platform owner" coordinator flag is gone: the website owner now has a separate Platform Admin account.
    await User.collection.updateMany({ isPlatformOwner: { $exists: true } }, { $unset: { isPlatformOwner: '' } });
    // Institutions that were waiting for approval are activated once their coordinator has verified the email.
    for (const inst of await Institution.find({ status: 'pending' })) {
      const c = await User.collection.findOne({ institution: inst._id, role: 'coordinator', emailVerified: true, approvalStatus: 'pending' });
      if (!c) continue;
      await Institution.updateOne({ _id: inst._id }, { $set: { status: 'approved', decidedAt: new Date(), statusNote: 'Activated after email verification' } });
      await User.collection.updateOne({ _id: c._id }, { $set: { approvalStatus: 'approved', isActive: true } });
      log(`[migrate] activated "${inst.name}" (its coordinator had verified the email)`);
    }

    await batchExistingStudents(log);
  });
}

// Students and groups created before batches existed get a starting batch, so nothing is left without one.
async function batchExistingStudents(log) {
  for (const dep of await Department.find({})) {
    const students = await User.find({ role: 'student', department: dep._id, institution: dep.institution, batch: { $exists: false } }).select('term').lean();
    const groups = await ProjectGroup.find({ department: dep._id, institution: dep.institution, batch: { $exists: false } }).select('term').lean();
    if (!students.length && !groups.length) continue;
    let batch = await Batch.findOne({ department: dep._id, name: 'Existing students' });
    if (!batch) {
      const counts = new Map();
      for (const x of [...students, ...groups]) if (x.term) counts.set(String(x.term), (counts.get(String(x.term)) || 0) + 1);
      const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
      const term = (top && (await AcademicTerm.findById(top))) || (await AcademicTerm.findOne({ institution: dep.institution, isCurrent: true }));
      batch = await Batch.create({ institution: dep.institution, department: dep._id, name: 'Existing students', term: term?._id, intakeYear: term?.startDate?.getFullYear(), allowSignup: false, note: 'Created automatically for students who registered before batches existed. Rename it or move students to their real batches.' });
    }
    await User.updateMany({ _id: { $in: students.map((x) => x._id) } }, { $set: { batch: batch._id } });
    const gids = groups.map((x) => x._id);
    await ProjectGroup.updateMany({ _id: { $in: gids } }, { $set: { batch: batch._id } });
    await Project.updateMany({ group: { $in: gids }, batch: { $exists: false } }, { $set: { batch: batch._id } });
    log(`[migrate] "${dep.name}": ${students.length} students and ${groups.length} groups put into the batch "Existing students"`);
  }
}
