import { User, Department, AcademicTerm, Project, ProjectGroup, PlatformAdmin } from '../models/index.js';
import { ROLES } from '../models/User.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler, ok, parsePage, pageMeta, parseSort, escapeRegex, isId, generateTempPassword, passwordProblem } from '../utils/helpers.js';
import { audit } from '../services/audit.js';
import { sameId } from '../utils/helpers.js';

const CREATABLE_ROLES = ['student', 'supervisor', 'coordinator'];

export const listUsers = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePage(req.query);
  const filter = {};
  if (ROLES.includes(req.query.role)) filter.role = req.query.role;
  if (isId(req.query.department)) filter.department = req.query.department;
  if (req.query.approval === 'pending') filter.approvalStatus = 'pending';
  if (req.query.active === 'true') filter.isActive = true;
  if (req.query.active === 'false') filter.isActive = false;
  if (req.query.q) {
    const rx = new RegExp(escapeRegex(String(req.query.q).slice(0, 80)), 'i');
    filter.$or = [{ name: rx }, { email: rx }, { studentId: rx }];
  }
  const sort = parseSort(req.query, ['name', 'email', 'role', 'createdAt', 'lastLoginAt'], { createdAt: -1 });

  const [items, total] = await Promise.all([
    User.find(filter).populate('department', 'name code').sort(sort).skip(skip).limit(limit),
    User.countDocuments(filter),
  ]);

  let data = items.map((u) => u.toJSON());
  if (req.query.withWorkload === '1') {
    const rows = await Project.aggregate([
      { $match: { supervisor: { $in: items.map((u) => u._id) }, status: { $nin: ['archived', 'completed'] } } },
      { $group: { _id: '$supervisor', count: { $sum: 1 } } },
    ]);
    const map = new Map(rows.map((r) => [String(r._id), r.count]));
    data = data.map((u) => ({ ...u, workload: map.get(String(u._id)) || 0 }));
  }
  ok(res, data, 200, pageMeta(page, limit, total));
});

export const getUser = asyncHandler(async (req, res) => {
  if (!isId(req.params.id)) throw new AppError('User not found', 404);
  const user = await User.findById(req.params.id).populate('department', 'name code').populate('term', 'name');
  if (!user) throw new AppError('User not found', 404);
  const extra = {};
  if (user.role === 'student') {
    extra.groups = await ProjectGroup.find({ 'members.user': user._id }).select('name status code').lean();
  }
  if (user.role === 'supervisor') {
    extra.projectCount = await Project.countDocuments({ supervisor: user._id, status: { $nin: ['archived', 'completed'] } });
  }
  ok(res, { user: user.toJSON(), ...extra });
});

/** Coordinator creates accounts for every role (this is how privileged users are onboarded). */
export const createUser = asyncHandler(async (req, res) => {
  const { name, email, role, departmentId, termId, studentId, phone, designation, maxProjects, password } = req.body;
  if (!CREATABLE_ROLES.includes(role)) throw new AppError('Choose student, supervisor or coordinator. External evaluators are created from External Evaluators.', 422, { role: 'Invalid role' });
  if ((await User.exists({ email })) || (await PlatformAdmin.exists({ email }))) throw new AppError('A user with this email already exists', 409, { email: 'Already in use' });
  if (role === 'student') {
    if (!studentId) throw new AppError('Student ID is required for students', 422, { studentId: 'Required' });
    if (!departmentId) throw new AppError('Department is required for students', 422, { departmentId: 'Required' });
    if (await User.exists({ studentId })) throw new AppError('This student ID already exists', 409, { studentId: 'Already in use' });
  }
  if (role === 'supervisor' && !departmentId) throw new AppError('Department is required for supervisors', 422, { departmentId: 'Required' });
  if (departmentId && !(await Department.exists({ _id: departmentId }))) throw new AppError('Department not found', 422, { departmentId: 'Not found' });
  if (termId && !(await AcademicTerm.exists({ _id: termId }))) throw new AppError('Academic term not found', 422, { termId: 'Not found' });

  const temporaryPassword = password || generateTempPassword();
  const problem = passwordProblem(temporaryPassword);
  if (problem) throw new AppError(problem, 422, { password: problem });

  const user = new User({
    name,
    email,
    role,
    department: departmentId || undefined,
    term: role === 'student' ? termId || (await AcademicTerm.findOne({ isCurrent: true }))?._id : undefined,
    studentId: role === 'student' ? studentId : undefined,
    phone,
    designation: role === 'supervisor' ? designation : undefined,
    maxProjects: role === 'supervisor' && maxProjects ? maxProjects : undefined,
    mustChangePassword: true,
  });
  await user.setPassword(temporaryPassword);
  await user.save();
  await audit(req, { action: 'user.created', entityType: 'User', entityId: user._id, summary: `Created ${role} account for ${name}` });
  // The temporary password is shown ONCE here and never stored in readable form.
  ok(res, { user: user.toJSON(), temporaryPassword }, 201);
});

export const updateUser = asyncHandler(async (req, res) => {
  if (!isId(req.params.id)) throw new AppError('User not found', 404);
  const user = await User.findById(req.params.id);
  if (!user) throw new AppError('User not found', 404);
  if (user.deletedAt) throw new AppError('This account was deleted by its owner.', 409);
  const { name, phone, departmentId, studentId, designation, maxProjects, termId } = req.body;
  if (name !== undefined) user.name = name;
  if (phone !== undefined) user.phone = phone;
  if (departmentId) {
    if (!(await Department.exists({ _id: departmentId }))) throw new AppError('Department not found', 422);
    user.department = departmentId;
  }
  if (termId) user.term = termId;
  if (studentId !== undefined && user.role === 'student') {
    if (studentId && (await User.exists({ studentId, _id: { $ne: user._id } }))) throw new AppError('This student ID already exists', 409);
    user.studentId = studentId || undefined;
  }
  if (user.role === 'supervisor') {
    if (designation !== undefined) user.designation = designation;
    if (maxProjects) user.maxProjects = maxProjects;
  }
  await user.save();
  await audit(req, { action: 'user.updated', entityType: 'User', entityId: user._id, summary: `Updated ${user.name}` });
  ok(res, { user: user.toJSON() });
});

/** Activate / deactivate. Records are never deleted, so academic history is preserved. */
export const setUserStatus = asyncHandler(async (req, res) => {
  if (!isId(req.params.id)) throw new AppError('User not found', 404);
  const user = await User.findById(req.params.id);
  if (!user) throw new AppError('User not found', 404);
  if (user.deletedAt) throw new AppError('This account was deleted by its owner and cannot be reactivated.', 409);
  if (sameId(user._id, req.user._id)) throw new AppError('You cannot deactivate your own account', 409);
  if (user.approvalStatus === 'pending' || user.approvalStatus === 'rejected') throw new AppError('This account is waiting for approval. Use Approve or Reject instead.', 409);
  user.isActive = req.body.isActive;
  if (!user.isActive) user.tokenVersion += 1; // ends active sessions immediately
  await user.save();
  await audit(req, {
    action: user.isActive ? 'user.activated' : 'user.deactivated',
    entityType: 'User',
    entityId: user._id,
    summary: `${user.isActive ? 'Activated' : 'Deactivated'} ${user.name}`,
  });
  ok(res, { user: user.toJSON() });
});

export const resetUserPassword = asyncHandler(async (req, res) => {
  if (!isId(req.params.id)) throw new AppError('User not found', 404);
  const user = await User.findById(req.params.id);
  if (!user) throw new AppError('User not found', 404);
  if (user.deletedAt) throw new AppError('This account was deleted by its owner.', 409);
  const temporaryPassword = generateTempPassword();
  await user.setPassword(temporaryPassword);
  user.mustChangePassword = true;
  user.tokenVersion += 1;
  await user.save();
  await audit(req, { action: 'user.password_reset_by_admin', entityType: 'User', entityId: user._id, summary: `Reset password for ${user.name}` });
  ok(res, { temporaryPassword });
});

/** Students look up a classmate by exact email to invite them (no browsing of all students). */
export const lookupStudent = asyncHandler(async (req, res) => {
  const email = String(req.query.email || '').trim().toLowerCase();
  if (!email) throw new AppError('Enter an email address', 422);
  const user = await User.findOne({ email, role: 'student', isActive: true, department: req.user.department }).select('name email studentId');
  if (!user) throw new AppError('No active student with this email was found in your department', 404);
  ok(res, { user: { _id: user._id, name: user.name, email: user.email, studentId: user.studentId } });
});

/** Coordinator approves or rejects a supervisor sign-up. */
export const decideApproval = asyncHandler(async (req, res) => {
  if (!isId(req.params.id)) throw new AppError('User not found', 404);
  const user = await User.findById(req.params.id);
  if (!user) throw new AppError('User not found', 404);
  if (user.approvalStatus !== 'pending') throw new AppError('This request has already been decided', 409);
  const approve = req.body.decision === 'approve';
  user.approvalStatus = approve ? 'approved' : 'rejected';
  user.isActive = approve;
  user.approvalNote = approve ? undefined : req.body.note;
  await user.save();
  await audit(req, { action: approve ? 'user.approved' : 'user.rejected', entityType: 'User', entityId: user._id, summary: `${approve ? 'Approved' : 'Rejected'} ${user.role} account for ${user.name}` });
  ok(res, { user: user.toJSON() });
});
