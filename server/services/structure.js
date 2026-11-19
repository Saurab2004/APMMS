// Faculties and departments of one institution. Used by the platform admin (any institution) and by the
// institution coordinator (their own institution), so the rules are the same in both places.
import { Faculty, Department, User, Batch, ProjectGroup } from '../models/index.js';
import { AppError } from '../utils/AppError.js';

const codeFrom = (name) => {
  const words = String(name).toUpperCase().replace(/[^A-Z0-9 ]/g, '').split(' ').filter(Boolean);
  return (words.length > 1 ? words.map((w) => w[0]).join('') : words[0] || 'DEPT').slice(0, 12);
};

export async function addFaculty(institutionId, { name, code, description }) {
  const clean = String(name).trim();
  if (await Faculty.exists({ institution: institutionId, name: clean })) throw new AppError('This institution already has a faculty with that name', 409, { name: 'Already used' });
  return Faculty.create({ institution: institutionId, name: clean, code: code ? String(code).trim() : undefined, description });
}

export async function changeFaculty(institutionId, id, patch) {
  const faculty = await Faculty.findOne({ _id: id, institution: institutionId });
  if (!faculty) throw new AppError('Faculty not found', 404);
  if (patch.name !== undefined && patch.name !== faculty.name && (await Faculty.exists({ institution: institutionId, name: patch.name, _id: { $ne: faculty._id } }))) throw new AppError('This institution already has a faculty with that name', 409, { name: 'Already used' });
  if (patch.isActive === false && (await Department.exists({ institution: institutionId, faculty: faculty._id, isActive: true }))) throw new AppError('This faculty still has active departments. Deactivate or move them first.', 409);
  for (const k of ['name', 'code', 'description', 'isActive']) if (patch[k] !== undefined) faculty[k] = patch[k];
  await faculty.save();
  return faculty;
}

export async function addDepartment(institutionId, { name, code, facultyId, description }) {
  const faculty = await Faculty.findOne({ _id: facultyId, institution: institutionId, isActive: true });
  if (!faculty) throw new AppError('Choose the faculty this department belongs to', 422, { facultyId: 'Required' });
  const clean = String(name).trim();
  if (await Department.exists({ institution: institutionId, name: clean })) throw new AppError('This institution already has a department with that name', 409, { name: 'Already used' });
  return Department.create({ institution: institutionId, faculty: faculty._id, name: clean, code: code ? String(code).trim() : codeFrom(clean), description });
}

export async function changeDepartment(institutionId, id, patch) {
  const dep = await Department.findOne({ _id: id, institution: institutionId });
  if (!dep) throw new AppError('Department not found', 404);
  if (patch.facultyId) {
    if (!(await Faculty.exists({ _id: patch.facultyId, institution: institutionId, isActive: true }))) throw new AppError('Faculty not found', 422, { facultyId: 'Not found' });
    dep.faculty = patch.facultyId;
  }
  if (patch.name !== undefined && patch.name !== dep.name && (await Department.exists({ institution: institutionId, name: patch.name, _id: { $ne: dep._id } }))) throw new AppError('This institution already has a department with that name', 409, { name: 'Already used' });
  for (const k of ['name', 'code', 'description', 'isActive']) if (patch[k] !== undefined) dep[k] = patch[k];
  await dep.save();
  return dep;
}

/** Deletes a faculty. Only allowed while it has no departments (delete or move them first). */
export async function removeFaculty(institutionId, id) {
  const faculty = await Faculty.findOne({ _id: id, institution: institutionId });
  if (!faculty) throw new AppError('Faculty not found', 404);
  const n = await Department.countDocuments({ institution: institutionId, faculty: faculty._id });
  if (n) throw new AppError(`This faculty still has ${n} department(s). Delete or move them first.`, 409);
  await faculty.deleteOne();
  return faculty;
}

/** Deletes a department that has no students, supervisors, batches or groups. Its coordinator account is removed with it. */
export async function removeDepartment(institutionId, id) {
  const dep = await Department.findOne({ _id: id, institution: institutionId });
  if (!dep) throw new AppError('Department not found', 404);
  const people = await User.countDocuments({ institution: institutionId, department: dep._id, role: { $in: ['student', 'supervisor'] }, deletedAt: null });
  const batches = await Batch.countDocuments({ institution: institutionId, department: dep._id });
  const groups = await ProjectGroup.countDocuments({ institution: institutionId, department: dep._id });
  if (people || batches || groups) {
    throw new AppError(`This department still has ${people} user(s), ${batches} batch(es) and ${groups} group(s), so it cannot be deleted. Deactivate it instead.`, 409);
  }
  await User.deleteMany({ institution: institutionId, role: 'coordinator', coordinatorLevel: 'department', department: dep._id });
  await dep.deleteOne();
  return dep;
}

/** Faculties with their departments, and the department coordinator of each department (for the admin and coordinator screens). */
export async function structureOf(institutionId) {
  const [faculties, departments, coordinators] = await Promise.all([
    Faculty.find({ institution: institutionId }).sort('name').lean(),
    Department.find({ institution: institutionId }).sort('name').lean(),
    User.find({ institution: institutionId, role: 'coordinator', deletedAt: null }).select('name email isActive emailVerified invitePending coordinatorLevel department lastLoginAt').lean(),
  ]);
  const deptCoordinators = new Map();
  for (const c of coordinators) if (c.coordinatorLevel === 'department' && c.isActive) deptCoordinators.set(String(c.department), c);
  return {
    faculties,
    departments: departments.map((d) => ({ ...d, coordinator: deptCoordinators.get(String(d._id)) || null })),
    institutionCoordinators: coordinators.filter((c) => c.coordinatorLevel !== 'department'),
    inactiveDepartmentCoordinators: coordinators.filter((c) => c.coordinatorLevel === 'department' && !c.isActive),
  };
}
