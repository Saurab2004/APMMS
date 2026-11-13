import { Department, AcademicTerm, User, ProjectGroup } from '../models/index.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler, ok, isId } from '../utils/helpers.js';
import { audit } from '../services/audit.js';
import { getSettings, updateSettings, SETTING_RULES } from '../services/settings.js';

// ---------- Departments ----------
export const listDepartments = asyncHandler(async (req, res) => {
  const filter = req.user.role === 'coordinator' && req.query.all === '1' ? {} : { isActive: true };
  const items = await Department.find(filter).sort('name').lean();
  if (req.user.role === 'coordinator') {
    const counts = await User.aggregate([{ $match: { department: { $ne: null } } }, { $group: { _id: { d: '$department', r: '$role' }, n: { $sum: 1 } } }]);
    for (const d of items) {
      d.students = counts.find((c) => String(c._id.d) === String(d._id) && c._id.r === 'student')?.n || 0;
      d.supervisors = counts.find((c) => String(c._id.d) === String(d._id) && c._id.r === 'supervisor')?.n || 0;
    }
  }
  ok(res, items);
});

export const createDepartment = asyncHandler(async (req, res) => {
  const dep = await Department.create(req.body);
  await audit(req, { action: 'department.created', entityType: 'Department', entityId: dep._id, summary: `Created department ${dep.name}` });
  ok(res, dep, 201);
});

export const updateDepartment = asyncHandler(async (req, res) => {
  if (!isId(req.params.id)) throw new AppError('Department not found', 404);
  const dep = await Department.findById(req.params.id);
  if (!dep) throw new AppError('Department not found', 404);
  Object.assign(dep, req.body);
  await dep.save();
  await audit(req, { action: 'department.updated', entityType: 'Department', entityId: dep._id, summary: `Updated department ${dep.name}` });
  ok(res, dep);
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

export const createTerm = asyncHandler(async (req, res) => {
  const { isCurrent, proposalDeadline, finalReportDeadline, ...rest } = req.body;
  if (rest.endDate <= rest.startDate) throw new AppError('End date must be after the start date', 422, { endDate: 'Must be after start date' });
  const term = new AcademicTerm({ ...rest, deadlines: { proposal: proposalDeadline, finalReport: finalReportDeadline } });
  await makeCurrentIfNeeded(term, isCurrent);
  await term.save();
  await audit(req, { action: 'term.created', entityType: 'AcademicTerm', entityId: term._id, summary: `Created term ${term.name}` });
  ok(res, term, 201);
});

export const updateTerm = asyncHandler(async (req, res) => {
  if (!isId(req.params.id)) throw new AppError('Term not found', 404);
  const term = await AcademicTerm.findById(req.params.id);
  if (!term) throw new AppError('Term not found', 404);
  const { isCurrent, proposalDeadline, finalReportDeadline, ...rest } = req.body;
  Object.assign(term, rest);
  if (term.endDate <= term.startDate) throw new AppError('End date must be after the start date', 422, { endDate: 'Must be after start date' });
  if (proposalDeadline !== undefined) term.deadlines.proposal = proposalDeadline;
  if (finalReportDeadline !== undefined) term.deadlines.finalReport = finalReportDeadline;
  if (isCurrent === false) term.isCurrent = false;
  await makeCurrentIfNeeded(term, isCurrent === true);
  await term.save();
  await audit(req, { action: 'term.updated', entityType: 'AcademicTerm', entityId: term._id, summary: `Updated term ${term.name}` });
  ok(res, term);
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
