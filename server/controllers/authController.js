import crypto from 'crypto';
import env from '../config/env.js';
import { User, Department, AcademicTerm, Institution } from '../models/index.js';
import { notify } from '../services/notifications.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler, ok, passwordProblem, sha256 } from '../utils/helpers.js';
import { setAuthCookie, clearAuthCookie } from '../middleware/auth.js';
import { audit } from '../services/audit.js';
import { getSettings } from '../services/settings.js';
import { issueVerificationEmail, findForVerification } from '../services/emailVerification.js';
import { emailConfigured } from '../services/mailer.js';
import { assertInstitutionUsable } from '../middleware/auth.js';

const populatedUser = (id) => User.findById(id).populate('department', 'name code').populate('term', 'name academicYear semester').populate('institution', 'name type status');

const ROLE_LABEL = { student: 'Student', supervisor: 'Supervisor', coordinator: 'Coordinator', evaluator: 'External evaluator' };

function sameSecret(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

const platformOwnerExists = () => User.exists({ isPlatformOwner: true, isActive: true });
const nameKeyOf = (name) => String(name).trim().toLowerCase().replace(/\s+/g, ' ');
const deptCode = (name) => {
  const words = String(name).toUpperCase().replace(/[^A-Z0-9 ]/g, '').split(' ').filter(Boolean);
  return (words.length > 1 ? words.map((w) => w[0]).join('') : words[0] || 'DEPT').slice(0, 12);
};

export const login = asyncHandler(async (req, res) => {
  const { email, password, role } = req.body;
  const user = await User.findOne({ email }).select('+passwordHash');
  const valid = user ? await user.checkPassword(password) : false;
  // Same message for "no such user" and "wrong password" so accounts cannot be guessed.
  if (!valid) throw new AppError('Invalid email or password', 401);
  // The role the person picked on the login page must match their account (checked only after the password is right).
  if (role && role !== user.role) {
    throw new AppError(`This email belongs to a ${ROLE_LABEL[user.role]} account. Choose "${ROLE_LABEL[user.role]}" above and log in again.`, 403, { role: 'Wrong role selected' });
  }
  if (user.emailVerified === false) throw new AppError('Please verify your email address before logging in. We sent a link to your email - open it, or request a new one.', 403, { email: user.email }, 'EMAIL_NOT_VERIFIED');
  if (user.approvalStatus === 'pending') {
    const msg = user.role === 'coordinator'
      ? "Your institution is waiting for the platform administrator's approval. You can log in once it is approved."
      : `Your ${ROLE_LABEL[user.role]} account is waiting for the coordinator's approval. You can log in once it is approved.`;
    throw new AppError(msg, 403, undefined, 'PENDING_APPROVAL');
  }
  if (user.approvalStatus === 'rejected') throw new AppError(`Your account request was not approved${user.approvalNote ? `: ${user.approvalNote}` : ''}. Please contact the coordinator.`, 403, undefined, 'REJECTED');
  if (!user.isActive) throw new AppError('This account has been deactivated. Please contact the coordinator.', 403);
  if (user.accessExpiresAt && user.accessExpiresAt < new Date()) throw new AppError('Your temporary access has expired.', 403);
  await assertInstitutionUsable(user);

  user.lastLoginAt = new Date();
  await user.save();
  setAuthCookie(res, user);
  await audit({ user, ip: req.ip }, { action: 'auth.login', entityType: 'User', entityId: user._id, summary: `${user.name} logged in` });
  ok(res, { user: await populatedUser(user._id) });
});

export const logout = asyncHandler(async (_req, res) => {
  clearAuthCookie(res);
  ok(res, { message: 'Logged out' });
});

export const me = asyncHandler(async (req, res) => {
  ok(res, { user: await populatedUser(req.user._id) });
});

export const registrationOptions = asyncHandler(async (_req, res) => {
  const owner = await platformOwnerExists();
  const empty = !(await User.exists({}));
  const institutions = await Institution.find({ status: 'approved' }).select('name type').sort('name').lean();
  const departments = await Department.find({ isActive: true, institution: { $in: institutions.map((i) => i._id) } }).select('name code institution').sort('name').lean();
  const out = [];
  for (const inst of institutions) {
    const settings = await getSettings(inst._id);
    out.push({
      _id: inst._id, name: inst.name, type: inst.type,
      allowSelfRegistration: settings.allowSelfRegistration,
      departments: departments.filter((d) => String(d.institution) === String(inst._id)).map((d) => ({ _id: d._id, name: d.name, code: d.code })),
    });
  }
  ok(res, {
    institutions: out,
    // First-time setup: the very first coordinator becomes the platform owner (approves every later institution).
    platform: {
      needsSetup: !owner,
      // A code is needed unless this is a brand new local database in development.
      needsSetupCode: !owner && !(empty && !env.isProd),
      setupCodeConfigured: Boolean(env.coordinatorSetupCode),
    },
  });
});

/**
 * Public registration with a role choice (and an institution).
 *  - student:     joins an approved institution; must verify email, then can log in
 *  - supervisor:  same, but also waits for that institution's coordinator to approve
 *  - coordinator: registers a NEW institution (see registerCoordinator)
 */
export const register = asyncHandler(async (req, res) => {
  const { name, email, password, studentId, departmentId, institutionId, institutionName, institutionType, departmentName, role = 'student', designation, setupCode } = req.body;
  if (!['student', 'supervisor', 'coordinator'].includes(role)) throw new AppError('Choose Student, Supervisor or Coordinator', 422, { role: 'Invalid role' });
  const problem = passwordProblem(password);
  if (problem) throw new AppError(problem, 422, { password: problem });
  if (await User.exists({ email })) throw new AppError('An account with this email already exists', 409, { email: 'Already registered' });

  if (role === 'coordinator') return registerCoordinator(req, res, { name, email, password, institutionName, institutionType, departmentName, setupCode });

  // Students and supervisors join ONE existing, approved institution.
  if (!institutionId) throw new AppError('Please choose your institution', 422, { institutionId: 'Required' });
  const institution = await Institution.findOne({ _id: institutionId, status: 'approved' });
  if (!institution) throw new AppError('Please choose a valid institution', 422, { institutionId: 'Invalid institution' });
  const settings = await getSettings(institution._id);
  if (!settings.allowSelfRegistration) throw new AppError('Self-registration is disabled at this institution. Please contact its coordinator.', 403);
  const department = await Department.findOne({ _id: departmentId, institution: institution._id, isActive: true });
  if (!department) throw new AppError('Please choose a valid department', 422, { departmentId: 'Invalid department' });

  if (role === 'supervisor') {
    const user = new User({ name, email, role: 'supervisor', institution: institution._id, department: department._id, designation, isActive: false, approvalStatus: 'pending', emailVerified: false });
    await user.setPassword(password);
    await user.save();
    const coordinators = await User.find({ role: 'coordinator', isActive: true, institution: institution._id }).select('_id').lean();
    await notify(coordinators.map((c) => c._id), { type: 'approval_request', title: 'Supervisor account waiting for approval', body: `${name} (${email}) asked to join as a supervisor.`, link: '/coordinator/users?tab=pending', dedupeKey: `approval:${user._id}` });
    await audit({ user, ip: req.ip }, { action: 'auth.register_pending', entityType: 'User', entityId: user._id, summary: `${name} requested a supervisor account` });
    const mail = await sendVerification(user._id);
    return ok(res, { pending: true, verificationRequired: true, email, emailSent: mail.sent, message: 'Request sent. Check your email and verify it, then wait for your institution\'s coordinator to approve your supervisor account before you can log in.' }, 201);
  }

  if (!studentId || String(studentId).trim().length < 2) throw new AppError('Student ID is required', 422, { studentId: 'Required' });
  if (await User.exists({ studentId, institution: institution._id })) throw new AppError('This student ID is already registered at this institution', 409, { studentId: 'Already registered' });
  const term = await AcademicTerm.findOne({ isCurrent: true, institution: institution._id });
  const user = new User({ name, email, role: 'student', institution: institution._id, studentId, department: department._id, term: term?._id, emailVerified: false });
  await user.setPassword(password);
  await user.save();
  // No login cookie yet: the student must open the emailed link first.
  await audit({ user, ip: req.ip }, { action: 'auth.register', entityType: 'User', entityId: user._id, summary: `${name} registered (email not verified yet)` });
  const mail = await sendVerification(user._id);
  ok(res, { verificationRequired: true, email, emailSent: mail.sent, message: 'Account created. Please check your email and open the verification link before logging in.' }, 201);
});

/**
 * Coordinator sign-up = "register my institution".
 *  - Very first coordinator on a new installation (platform setup): needs the setup code from server/.env
 *    (not needed on an empty local development database). The institution is approved at once and the person
 *    becomes the platform owner.
 *  - Everyone after that: the institution and its coordinator wait until the platform owner approves them.
 */
async function registerCoordinator(req, res, { name, email, password, institutionName, institutionType, departmentName, setupCode }) {
  if (!institutionName || String(institutionName).trim().length < 3) throw new AppError('Enter the name of your institution', 422, { institutionName: 'Required (at least 3 characters)' });
  const nameKey = nameKeyOf(institutionName);
  if (await Institution.exists({ nameKey, status: { $in: ['pending', 'approved', 'suspended'] } })) {
    throw new AppError('An institution with this name is already registered. If you work there, sign up as a Supervisor or Student and choose it, or ask its coordinator.', 409, { institutionName: 'Already registered' });
  }
  const owner = await platformOwnerExists();
  const bootstrap = !owner;
  if (bootstrap) {
    const brandNew = !(await User.exists({})) && !env.isProd;
    if (!brandNew) {
      if (!env.coordinatorSetupCode) throw new AppError('First-time setup needs COORDINATOR_SETUP_CODE in server/.env. Set it, restart the server and try again.', 403, { setupCode: 'Not configured on the server' });
      if (!setupCode || !sameSecret(setupCode, env.coordinatorSetupCode)) throw new AppError('The setup code is not correct', 403, { setupCode: 'Incorrect code' });
    }
  }

  const institution = await Institution.create({
    name: String(institutionName).trim(), nameKey, type: institutionType || 'university',
    status: bootstrap ? 'approved' : 'pending', decidedAt: bootstrap ? new Date() : undefined,
  });
  if (departmentName && String(departmentName).trim()) {
    await Department.create({ institution: institution._id, name: String(departmentName).trim(), code: deptCode(departmentName) });
  }
  const user = new User(bootstrap
    ? { name, email, role: 'coordinator', institution: institution._id, isPlatformOwner: true, emailVerified: true, emailVerifiedAt: new Date() } // holding the setup code already proves access
    : { name, email, role: 'coordinator', institution: institution._id, isActive: false, approvalStatus: 'pending', emailVerified: false });
  await user.setPassword(password);
  await user.save();

  if (bootstrap) {
    setAuthCookie(res, user);
    await audit({ user, ip: req.ip }, { action: 'auth.platform_setup', entityType: 'User', entityId: user._id, summary: `${name} set up the platform with ${institution.name}` });
    return ok(res, { user: await populatedUser(user._id) }, 201);
  }

  const owners = await User.find({ isPlatformOwner: true, isActive: true }).select('_id').lean();
  await notify(owners.map((o) => o._id), { type: 'approval_request', title: 'New institution waiting for approval', body: `${institution.name} (${name}, ${email}) asked to join APMMS.`, link: '/coordinator/institutions', dedupeKey: `institution:${institution._id}` });
  await audit({ user, ip: req.ip }, { action: 'auth.institution_requested', entityType: 'Institution', entityId: institution._id, summary: `${name} requested a workspace for ${institution.name}` });
  const mail = await sendVerification(user._id);
  return ok(res, { pending: true, verificationRequired: true, email, emailSent: mail.sent, message: 'Request sent. Verify your email, then wait for the platform administrator to approve your institution before you can log in.' }, 201);
}

export const forgotPassword = asyncHandler(async (req, res) => {
  const user = await User.findOne({ email: req.body.email, isActive: true });
  if (user) {
    const token = crypto.randomBytes(32).toString('hex');
    user.passwordResetTokenHash = sha256(token);
    user.passwordResetExpires = new Date(Date.now() + 30 * 60 * 1000);
    await user.save();
    // Email is NOT configured in this project. The link is printed on the server console so you
    // can test the flow. To send real email, plug a provider into this spot.
    console.log(`[password-reset] ${user.email}: ${env.clientOrigin}/reset-password?token=${token}  (valid 30 minutes)`);
    await audit({ user, ip: req.ip }, { action: 'auth.password_reset_requested', entityType: 'User', entityId: user._id });
  }
  // Always the same answer so nobody can discover which emails exist.
  ok(res, { message: 'If an account with that email exists, a password reset link has been generated.' });
});

export const resetPassword = asyncHandler(async (req, res) => {
  const { token, password } = req.body;
  const problem = passwordProblem(password);
  if (problem) throw new AppError(problem, 422, { password: problem });
  const user = await User.findOne({
    passwordResetTokenHash: sha256(token),
    passwordResetExpires: { $gt: new Date() },
  }).select('+passwordResetTokenHash +passwordResetExpires');
  if (!user) throw new AppError('This reset link is invalid or has expired', 400);
  await user.setPassword(password);
  user.passwordResetTokenHash = undefined;
  user.passwordResetExpires = undefined;
  user.mustChangePassword = false;
  user.tokenVersion += 1; // logs out every existing session
  await user.save();
  await audit({ user, ip: req.ip }, { action: 'auth.password_reset', entityType: 'User', entityId: user._id });
  ok(res, { message: 'Password updated. You can now log in.' });
});

export const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const problem = passwordProblem(newPassword);
  if (problem) throw new AppError(problem, 422, { newPassword: problem });
  const user = await User.findById(req.user._id).select('+passwordHash');
  if (!(await user.checkPassword(currentPassword))) throw new AppError('Current password is incorrect', 400, { currentPassword: 'Incorrect' });
  if (currentPassword === newPassword) throw new AppError('Choose a password different from the current one', 422, { newPassword: 'Must be different' });
  await user.setPassword(newPassword);
  user.mustChangePassword = false;
  user.tokenVersion += 1;
  await user.save();
  setAuthCookie(res, user); // keep this browser logged in with the new token
  await audit(req, { action: 'auth.password_changed', entityType: 'User', entityId: user._id });
  ok(res, { message: 'Password changed', user: await populatedUser(user._id) });
});

export const updateProfile = asyncHandler(async (req, res) => {
  const { name, phone, bio, designation, expertise, notificationPrefs } = req.body;
  const user = await User.findById(req.user._id);
  if (name !== undefined) user.name = name;
  if (phone !== undefined) user.phone = phone;
  if (bio !== undefined) user.bio = bio;
  if (user.role === 'supervisor') {
    if (designation !== undefined) user.designation = designation;
    if (expertise !== undefined) user.expertise = expertise;
  }
  if (notificationPrefs) {
    for (const k of ['chat', 'feedback', 'deadlines']) {
      if (typeof notificationPrefs[k] === 'boolean') user.notificationPrefs[k] = notificationPrefs[k];
    }
  }
  await user.save();
  ok(res, { user: await populatedUser(user._id) });
});



// ---------------------------------------------------------------- email verification
async function sendVerification(userId) {
  const user = await findForVerification({ _id: userId });
  return issueVerificationEmail(user);
}

/** POST /auth/verify-email  { token } - the link in the email lands on a page that calls this. */
export const verifyEmail = asyncHandler(async (req, res) => {
  const hash = sha256(String(req.body.token));
  const user = await findForVerification({ 'emailVerification.tokenHash': hash });
  if (user) {
    if (!user.emailVerification.expiresAt || user.emailVerification.expiresAt < new Date()) {
      throw new AppError('This verification link has expired. Request a new one below.', 410, { email: user.email }, 'TOKEN_EXPIRED');
    }
    user.emailVerified = true;
    user.emailVerifiedAt = new Date();
    user.emailVerification = { usedHash: hash }; // the token itself is removed so it cannot be used twice
    await user.save();
    await audit({ user, ip: req.ip }, { action: 'auth.email_verified', entityType: 'User', entityId: user._id, summary: `${user.name} verified their email` });
    return ok(res, { verified: true, role: user.role, pendingApproval: user.approvalStatus === 'pending', message: 'Your email is verified.' });
  }
  const used = await User.findOne({ 'emailVerification.usedHash': hash }).select('role approvalStatus');
  if (used) {
    throw new AppError('This link was already used. Your email is verified - you can log in.', 409, { role: used.role, pendingApproval: used.approvalStatus === 'pending' }, 'TOKEN_USED');
  }
  throw new AppError('This verification link is not valid. Check that you copied the whole link, or request a new one.', 400, undefined, 'TOKEN_INVALID');
});

/** POST /auth/resend-verification  { email } - same answer whether or not the account exists. */
export const resendVerification = asyncHandler(async (req, res) => {
  const generic = { message: 'If this email belongs to an account that still needs verifying, a new link has been sent. You can request one every minute.' };
  const user = await findForVerification({ email: req.body.email, emailVerified: false });
  if (user && !user.deletedAt) await issueVerificationEmail(user);
  ok(res, generic);
});

/** Coordinator safeguard for when email cannot be delivered (for example no SMTP yet). */
export const markEmailVerified = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user || user.deletedAt) throw new AppError('User not found', 404);
  user.emailVerified = true;
  user.emailVerifiedAt = new Date();
  user.emailVerification = {};
  await user.save();
  await audit(req, { action: 'user.email_marked_verified', entityType: 'User', entityId: user._id, summary: `Marked ${user.name}'s email as verified` });
  ok(res, { user: user.toJSON() });
});

/** POST /auth/onboarding-seen - remembers (per account) that the welcome guide was shown or skipped. */
export const onboardingSeen = asyncHandler(async (req, res) => {
  await User.updateOne({ _id: req.user._id }, { $set: { onboardingSeenAt: new Date() } });
  ok(res, { onboardingSeenAt: new Date() });
});

/**
 * POST /auth/delete-account  { password, confirmText } - coordinator only, own account only.
 * Soft delete: the row is kept (so projects, evaluations and the audit log still point to a real person record),
 * but the account can no longer log in and its personal contact details are wiped.
 */
export const deleteMyAccount = asyncHandler(async (req, res) => {
  const me = await User.findById(req.user._id).select('+passwordHash');
  if (!me || me.role !== 'coordinator') throw new AppError('Only a coordinator can use this option.', 403);
  if (String(req.body.confirmText || '').trim().toUpperCase() !== 'DELETE') throw new AppError('Type DELETE to confirm.', 422, { confirmText: 'Type DELETE to confirm' });
  if (!(await me.checkPassword(req.body.password))) throw new AppError('Your password is not correct.', 422, { password: 'Incorrect password' });
  const others = await User.countDocuments({ role: 'coordinator', isActive: true, approvalStatus: 'approved', _id: { $ne: me._id } }); // same institution only (automatic)
  if (me.isPlatformOwner && !(await User.exists({ isPlatformOwner: true, isActive: true, _id: { $ne: me._id } }))) throw new AppError('You are the platform owner who approves new institutions. Make another coordinator the platform owner first (Institutions page).', 409, undefined, 'LAST_PLATFORM_OWNER');
  if (!others) throw new AppError('You are the only active coordinator of your institution. Create another coordinator account first, so the institution is not left without one.', 409, undefined, 'LAST_COORDINATOR');

  const oldEmail = me.email;
  const name = me.name;
  me.isActive = false;
  me.deletedAt = new Date();
  me.tokenVersion += 1; // every session of this account stops working immediately
  me.email = `deleted-${me._id}@deleted.invalid`; // frees the address; the name stays so records still show who did what
  me.phone = undefined;
  me.bio = undefined;
  me.passwordHash = crypto.randomBytes(24).toString('hex'); // not a valid bcrypt hash, so no password can ever match
  me.emailVerification = {};
  await me.save();
  await audit({ user: me, ip: req.ip }, { action: 'user.self_deleted', entityType: 'User', entityId: me._id, summary: `Coordinator ${name} deleted their own account (soft delete, records kept)`, meta: { formerEmail: oldEmail.replace(/^(.).*(@.*)$/, '$1***$2') } });
  clearAuthCookie(res);
  ok(res, { message: 'Your account has been deleted. Academic records were kept.' });
});

export { emailConfigured };
