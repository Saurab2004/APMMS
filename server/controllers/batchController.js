import { Batch, AcademicTerm, Department, User, ProjectGroup, Project } from '../models/index.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler, ok, isId, idStr } from '../utils/helpers.js';
import { audit } from '../services/audit.js';

const FINISHED = ['evaluated', 'completed', 'archived'];

const shape = (b, counts) => ({ ...(b.toObject ? b.toObject() : b), students: counts?.students?.get(idStr(b._id)) || 0, groups: counts?.groups?.get(idStr(b._id)) || 0 });

async function loadBatch(id) {
  if (!isId(id)) throw new AppError('Batch not found', 404);
  const batch = await Batch.findById(id);
  if (!batch) throw new AppError('Batch not found', 404);
  return batch;
}

async function checkTerm(termId) {
  if (!termId) return null;
  const term = await AcademicTerm.findById(termId);
  if (!term) throw new AppError('Academic term not found', 422, { termId: 'Not found' });
  return term;
}

// Everyone signed in can read the list (supervisors use it for filters). Only the coordinator sees completed batches by default.
export const listBatches = asyncHandler(async (req, res) => {
  const filter = {};
  if (isId(req.query.department)) filter.department = req.query.department;
  const coordinator = req.user.role === 'coordinator';
  if (!coordinator || req.query.all !== '1') filter.status = 'active';
  const items = await Batch.find(filter).populate('department', 'name code').populate('term', 'name academicYear semester').sort({ intakeYear: -1, name: 1 });
  let counts;
  if (coordinator) {
    const ids = items.map((b) => b._id);
    const [stu, grp] = await Promise.all([
      User.aggregate([{ $match: { role: 'student', batch: { $in: ids } } }, { $group: { _id: '$batch', n: { $sum: 1 } } }]),
      ProjectGroup.aggregate([{ $match: { batch: { $in: ids }, status: 'active' } }, { $group: { _id: '$batch', n: { $sum: 1 } } }]),
    ]);
    counts = { students: new Map(stu.map((r) => [idStr(r._id), r.n])), groups: new Map(grp.map((r) => [idStr(r._id), r.n])) };
  }
  ok(res, items.map((b) => shape(b, counts)));
});

export const createBatch = asyncHandler(async (req, res) => {
  const { name, departmentId, intakeYear, termId, allowSignup, note } = req.body;
  if (!(await Department.exists({ _id: departmentId, isActive: true }))) throw new AppError('Department not found', 422, { departmentId: 'Not found' });
  await checkTerm(termId);
  if (await Batch.exists({ department: departmentId, name })) throw new AppError('This department already has a batch with that name', 409, { name: 'Already used' });
  const batch = await Batch.create({ name, department: departmentId, intakeYear, term: termId || undefined, allowSignup: allowSignup !== false, note });
  await audit(req, { action: 'batch.created', entityType: 'Batch', entityId: batch._id, summary: `Created batch ${batch.name}` });
  ok(res, batch, 201);
});

export const updateBatch = asyncHandler(async (req, res) => {
  const batch = await loadBatch(req.params.id);
  const { name, intakeYear, allowSignup, note, status } = req.body;
  if (name !== undefined && name !== batch.name) {
    if (await Batch.exists({ department: batch.department, name, _id: { $ne: batch._id } })) throw new AppError('This department already has a batch with that name', 409, { name: 'Already used' });
    batch.name = name;
  }
  if (intakeYear !== undefined) batch.intakeYear = intakeYear;
  if (allowSignup !== undefined) batch.allowSignup = allowSignup;
  if (note !== undefined) batch.note = note;
  if (status !== undefined) {
    batch.status = status;
    if (status === 'completed') batch.allowSignup = false;
  }
  await batch.save();
  await audit(req, { action: 'batch.updated', entityType: 'Batch', entityId: batch._id, summary: `Updated batch ${batch.name}${status ? ` (${status})` : ''}` });
  ok(res, batch);
});

/** Put a whole batch into another term (for example Semester 7 -> Semester 8). Students follow; unfinished groups can follow too. */
export const moveBatchTerm = asyncHandler(async (req, res) => {
  const batch = await loadBatch(req.params.id);
  if (batch.status === 'completed') throw new AppError('This batch is completed. Re-open it first.', 409);
  const term = await checkTerm(req.body.termId);
  if (!term) throw new AppError('Choose a term', 422, { termId: 'Required' });
  if (!term.isActive) throw new AppError('That term is archived. Choose an active term.', 409, { termId: 'Archived' });
  const moveGroups = req.body.moveGroups !== false;
  const from = batch.term;
  batch.term = term._id;
  await batch.save();
  await User.updateMany({ batch: batch._id, role: 'student' }, { $set: { term: term._id } });

  let moved = 0;
  let skipped = 0;
  if (moveGroups && idStr(from) !== idStr(term._id)) {
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
  await audit(req, { action: 'batch.term_changed', entityType: 'Batch', entityId: batch._id, summary: `Moved batch ${batch.name} to ${term.name} (${moved} groups moved, ${skipped} skipped)` });
  ok(res, { batch, movedGroups: moved, skippedGroups: skipped });
});

/** Coordinator view: how many unfinished projects each supervisor has, per batch. */
export const workload = asyncHandler(async (req, res) => {
  const filter = {};
  if (isId(req.query.department)) filter.department = req.query.department;
  const supervisors = await User.find({ role: 'supervisor', isActive: true, ...filter }).select('name email department maxProjects').populate('department', 'name').sort('name').lean();
  const rows = await Project.aggregate([
    { $match: { supervisor: { $in: supervisors.map((s) => s._id) }, status: { $nin: ['archived', 'completed'] } } },
    { $group: { _id: { s: '$supervisor', b: '$batch' }, n: { $sum: 1 } } },
  ]);
  const batches = await Batch.find({ _id: { $in: rows.map((r) => r._id.b).filter(Boolean) } }).select('name').lean();
  const bname = new Map(batches.map((b) => [idStr(b._id), b.name]));
  ok(res, supervisors.map((s) => {
    const mine = rows.filter((r) => idStr(r._id.s) === idStr(s._id));
    return { _id: s._id, name: s.name, email: s.email, department: s.department, maxProjects: s.maxProjects, total: mine.reduce((a, r) => a + r.n, 0), perBatch: mine.map((r) => ({ batch: r._id.b ? { _id: r._id.b, name: bname.get(idStr(r._id.b)) || 'Unknown' } : null, count: r.n })) };
  }));
});
