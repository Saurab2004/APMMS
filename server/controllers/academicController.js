import { Faculty, Department, AcademicTerm, Batch, User, ProjectGroup, Institution } from '../models/index.js';
import { moveBatchToTerm } from '../services/batches.js';
import { addFaculty, changeFaculty, addDepartment, changeDepartment, removeFaculty, removeDepartment, structureOf } from '../services/structure.js';
import { inviteCoordinator, issueSetPasswordLink, roleText } from '../services/invitations.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler, ok, isId } from '../utils/helpers.js';
import { emailConfigured } from '../services/mailer.js';
import { audit } from '../services/audit.js';
import { getSettings, updateSettings, SETTING_RULES } from '../services/settings.js';

// ---------- Faculties and departments ----------
// The platform admin sets these up when adding an institution; the institution coordinator can add more later.
export const listFaculties = asyncHandler(async (req, res) => {
  const filter = req.user.role === 'coordinator' && req.query.all === '1' ? {} : { isActive: true };
  const items = await Faculty.find(filter).sort('name').lean();
  if (req.user.role === 'coordinator') {
    const counts = await Department.aggregate([{ $group: { _id: '$faculty', n: { $sum: 1 } } }]);
    for (const f of items) f.departments = counts.find((c) => String(c._id) === String(f._id))?.n || 0;
  }
  ok(res, items);
});

export const createFaculty = asyncHandler(async (req, res) => {
  const f = await addFaculty(req.user.institution, req.body);
  await audit(req, { action: 'faculty.created', entityType: 'Faculty', entityId: f._id, summary: `Created faculty ${f.name}` });
  ok(res, f, 201);
});

export const updateFaculty = asyncHandler(async (req, res) => {
  if (!isId(req.params.id)) throw new AppError('Faculty not found', 404);
  const f = await changeFaculty(req.user.institution, req.params.id, req.body);
  await audit(req, { action: 'faculty.updated', entityType: 'Faculty', entityId: f._id, summary: `Updated faculty ${f.name}` });
  ok(res, f);
});

export const getStructure = asyncHandler(async (req, res) => {
  ok(res, { ...(await structureOf(req.user.institution)), emailConfigured: emailConfigured() });
});

export const deleteFaculty = asyncHandler(async (req, res) => {
  if (!isId(req.params.id)) throw new AppError('Faculty not found', 404);
  const f = await removeFaculty(req.user.institution, req.params.id);
  await audit(req, { action: 'faculty.deleted', entityType: 'Faculty', entityId: f._id, summary: `Deleted faculty ${f.name}` });
  ok(res, { deleted: true });
});

export const listDepartments = asyncHandler(async (req, res) => {
  const filter = req.user.role === 'coordinator' && req.query.all === '1' ? {} : { isActive: true };
  if (isId(req.query.faculty)) filter.faculty = req.query.faculty;
  const items = await Department.find(filter).populate('faculty', 'name').sort('name').lean();
  if (req.user.role === 'coordinator') {
    const counts = await User.aggregate([{ $match: { department: { $ne: null } } }, { $group: { _id: { d: '$department', r: '$role' }, n: { $sum: 1 } } }]);
    const coords = await User.find({ role: 'coordinator', coordinatorLevel: 'department', isActive: true, deletedAt: null }).select('name email department emailVerified invitePending').lean();
    for (const d of items) {
      d.students = counts.find((c) => String(c._id.d) === String(d._id) && c._id.r === 'student')?.n || 0;
      d.supervisors = counts.find((c) => String(c._id.d) === String(d._id) && c._id.r === 'supervisor')?.n || 0;
      d.coordinator = coords.find((c) => String(c.department) === String(d._id)) || null;
    }
  }
  ok(res, items);
});

export const createDepartment = asyncHandler(async (req, res) => {
  const dep = await addDepartment(req.user.institution, req.body);
  await audit(req, { action: 'department.created', entityType: 'Department', entityId: dep._id, summary: `Created department ${dep.name}` });
  ok(res, dep, 201);
});

export const updateDepartment = asyncHandler(async (req, res) => {
  if (!isId(req.params.id)) throw new AppError('Department not found', 404);
  const dep = await changeDepartment(req.user.institution, req.params.id, req.body);
  await audit(req, { action: 'department.updated', entityType: 'Department', entityId: dep._id, summary: `Updated department ${dep.name}` });
  ok(res, dep);
});

export const deleteDepartment = asyncHandler(async (req, res) => {
  if (!isId(req.params.id)) throw new AppError('Department not found', 404);
  const d = await removeDepartment(req.user.institution, req.params.id);
  await audit(req, { action: 'department.deleted', entityType: 'Department', entityId: d._id, summary: `Deleted department ${d.name}` });
  ok(res, { deleted: true });
});

/** The institution coordinator invites the coordinator of a department (one per department). */
export const inviteDepartmentCoordinator = asyncHandler(async (req, res) => {
  if (!isId(req.params.id)) throw new AppError('Department not found', 404);
  const institution = await Institution.findById(req.user.institution);
  const r = await inviteCoordinator({ institution, name: req.body.name, email: req.body.email, level: 'department', departmentId: req.params.id, invitedBy: req.user.name });
  await audit(req, { action: 'coordinator.invited', entityType: 'User', entityId: r.user._id, summary: `Invited ${r.user.email} as department coordinator` });
  ok(res, { coordinator: { _id: r.user._id, name: r.user.name, email: r.user.email }, emailed: r.sent, link: r.link }, 201);
});

/** Sends a new set-password link to a coordinator who has not set one yet (or lost it). */
export const resendCoordinatorInvite = asyncHandler(async (req, res) => {
  if (!isId(req.params.id)) throw new AppError('Coordinator not found', 404);
  const user = await User.findOne({ _id: req.params.id, role: 'coordinator', coordinatorLevel: 'department', deletedAt: null });
  if (!user) throw new AppError('Coordinator not found', 404);
  const institution = await Institution.findById(req.user.institution);
  const department = await Department.findById(user.department);
  const r = await issueSetPasswordLink(user, { institutionName: institution.name, roleText: roleText(user, department), invitedBy: req.user.name, reset: !user.invitePending });
  await audit(req, { action: 'coordinator.invite_resent', entityType: 'User', entityId: user._id, summary: `Sent a new set-password link to ${user.email}` });
  ok(res, { emailed: r.sent, link: r.link });
});

// ---------- Academic terms ----------
export const listTerms = asyncHandler(async (_req, res) => {
  ok(res, await AcademicTerm.find().sort({ startDate: -1 }).lean());
});

async function makeCurrentIfNeeded(term, wantCurrent) {
  if (wantCurrent) {
    await AcademicTerm.updateMany({ _id: { $ne: term._id } }, { $set: { isCurrent: false } });
    term.isCurrent = true;
  }
}

/** Links the chosen (active) batches to this term. Returns how many were linked and how many groups moved. */
async function linkBatches(term, batchIds, deptScope) {
  const out = { batches: 0, groups: 0, skipped: 0 };
  if (!term.isActive || !Array.isArray(batchIds)) return out;
  for (const id of [...new Set(batchIds.map(String))]) {
    const batch = await Batch.findOne({ _id: id, status: 'active', ...(deptScope ? { department: deptScope } : {}) });
    if (!batch) continue;
    const r = await moveBatchToTerm(batch, term, true);
    out.batches += 1; out.groups += r.moved; out.skipped += r.skipped;
  }
  return out;
}

export const createTerm = asyncHandler(async (req, res) => {
  const { isCurrent, proposalDeadline, finalReportDeadline, batchIds, ...rest } = req.body;
  if (rest.endDate <= rest.startDate) throw new AppError('End date must be after the start date', 422, { endDate: 'Must be after start date' });
  const term = new AcademicTerm({ ...rest, deadlines: { proposal: proposalDeadline, finalReport: finalReportDeadline } });
  await makeCurrentIfNeeded(term, isCurrent);
  await term.save();
  const linked = await linkBatches(term, batchIds, req.deptScope);
  await audit(req, { action: 'term.created', entityType: 'AcademicTerm', entityId: term._id, summary: `Created term ${term.name}${linked.batches ? ` with ${linked.batches} batch(es)` : ''}` });
  ok(res, { ...term.toObject(), linked }, 201);
});

export const updateTerm = asyncHandler(async (req, res) => {
  if (!isId(req.params.id)) throw new AppError('Term not found', 404);
  const term = await AcademicTerm.findById(req.params.id);
  if (!term) throw new AppError('Term not found', 404);
  const { isCurrent, proposalDeadline, finalReportDeadline, batchIds, ...rest } = req.body;
  Object.assign(term, rest);
  if (term.endDate <= term.startDate) throw new AppError('End date must be after the start date', 422, { endDate: 'Must be after start date' });
  if (proposalDeadline !== undefined) term.deadlines.proposal = proposalDeadline;
  if (finalReportDeadline !== undefined) term.deadlines.finalReport = finalReportDeadline;
  if (isCurrent === false) term.isCurrent = false;
  await makeCurrentIfNeeded(term, isCurrent === true);
  await term.save();
  const linked = await linkBatches(term, batchIds, req.deptScope);
  await audit(req, { action: 'term.updated', entityType: 'AcademicTerm', entityId: term._id, summary: `Updated term ${term.name}${linked.batches ? ` and linked ${linked.batches} batch(es)` : ''}` });
  ok(res, { ...term.toObject(), linked });
});

// ---------- Settings ----------
export const readSettings = asyncHandler(async (_req, res) => {
  const settings = await getSettings();
  ok(res, { settings, rules: req_rules() });
});

const req_rules = () =>
  Object.fromEntries(Object.entries(SETTING_RULES).map(([k, r]) => [k, { type: r.type, min: r.min, max: r.max, label: r.label }]));

export const saveSettings = asyncHandler(async (req, res) => {
  const settings = await updateSettings(req.body, req.user._id);
  await audit(req, { action: 'settings.updated', entityType: 'SystemSetting', summary: 'Updated system settings', meta: req.body });
  ok(res, { settings, rules: req_rules() });
});

export const groupCountForTerm = asyncHandler(async (req, res) => {
  ok(res, { count: await ProjectGroup.countDocuments({ term: req.params.id }) });
});
