// Permanently erases one institution: all its records (every collection) and its uploaded files.
// Only used after a coordinator deleted their institution (and the grace period passed) or chose "erase now",
// or when a platform admin purges it. Nothing else in the app ever hard-deletes records.
import mongoose from 'mongoose';
import { Institution } from '../models/index.js';
import { removeFile } from './storage.js';
import { runUnscoped } from '../utils/tenant.js';

function collectStoragePaths(value, out) {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) { for (const v of value) collectStoragePaths(v, out); return; }
  if (typeof value.storagePath === 'string') out.add(value.storagePath);
  for (const v of Object.values(value)) if (v && typeof v === 'object') collectStoragePaths(v, out);
}

export async function purgeInstitution(institutionId, { log = console.log } = {}) {
  return runUnscoped(async () => {
    const inst = await Institution.findById(institutionId);
    if (!inst) return { deleted: 0, files: 0 };
    const models = mongoose.modelNames().map((n) => mongoose.model(n)).filter((M) => M.schema.options.tenant !== false);
    const paths = new Set();
    for (const M of models) {
      const cursor = M.collection.find({ institution: inst._id });
      for await (const doc of cursor) collectStoragePaths(doc, paths);
    }
    let files = 0;
    for (const storagePath of paths) {
      try { await removeFile({ storagePath }); files += 1; } catch { /* already gone */ }
    }
    let deleted = 0;
    for (const M of models) {
      const r = await M.collection.deleteMany({ institution: inst._id });
      deleted += r.deletedCount || 0;
    }
    await Institution.deleteOne({ _id: inst._id });
    log(`[institution] erased "${inst.name}": ${deleted} records, ${files} files`);
    return { deleted, files };
  });
}

/** Erases institutions whose grace period is over. Called on a timer. */
export async function purgeDueInstitutions() {
  const due = await runUnscoped(() => Institution.find({ status: 'deleted', purgeAt: { $lte: new Date() } }).select('_id').lean());
  for (const i of due) await purgeInstitution(i._id);
  return due.length;
}

export function startPurgeTimer() {
  const run = () => purgeDueInstitutions().catch((e) => console.error('[institution] purge failed:', e.message));
  setTimeout(run, 30 * 1000).unref();
  setInterval(run, 6 * 60 * 60 * 1000).unref();
}
