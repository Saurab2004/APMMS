// One-time, safe upgrade of a database that was created before institutions existed.
// Runs when the server starts. It is idempotent (does nothing when everything already has an institution)
// and it never deletes anything:
//   1. old "unique across everything" indexes are replaced by "unique inside one institution" ones
//   2. records without an institution are moved into ONE institution named "Default Institution"
//      (change the name later in the database if you like) so existing users keep seeing their data
//   3. the earliest active coordinator becomes the platform owner (the person who approves new institutions)
import mongoose from 'mongoose';
import { Institution, User } from '../models/index.js';
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

    if (!(await User.exists({ isPlatformOwner: true }))) {
      const first = await User.findOne({ role: 'coordinator', isActive: true, approvalStatus: { $ne: 'rejected' } }).sort({ createdAt: 1 });
      if (first) {
        await User.collection.updateOne({ _id: first._id }, { $set: { isPlatformOwner: true } });
        log(`[migrate] ${first.email} is now the platform owner (approves new institutions)`);
      }
    }
  });
}
