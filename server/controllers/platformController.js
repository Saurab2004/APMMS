// The Platform Admin console (website owner). Everything here is separate from the institution workspaces:
// admins have their own accounts, cookie and routes (/api/platform/*), belong to no institution, and see only
// institution-level information (names, status, counts, coordinator accounts) - never students' project work.
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import env from '../config/env.js';
import { Institution, User, PlatformAdmin, PlatformAudit, ProjectGroup, Project, Department, Faculty, SystemSetting, INSTITUTION_TYPES } from '../models/index.js';
import { addFaculty, changeFaculty, addDepartment, changeDepartment, structureOf } from '../services/structure.js';
import { inviteCoordinator, issueSetPasswordLink, roleText } from '../services/invitations.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler, ok, isId, sameId, passwordProblem, generateTempPassword, escapeRegex, parsePage, pageMeta } from '../utils/helpers.js';
import { setAdminCookie, clearAdminCookie } from '../middleware/platformAuth.js';
import { platformAudit } from '../services/platformAudit.js';
import { sendMail, emailConfigured } from '../services/mailer.js';
import { purgeInstitution } from '../services/institutionPurge.js';
import { issueVerificationEmail, findForVerification } from '../services/emailVerification.js';
import { activateNewInstitution } from '../services/institutionActivation.js';
import { getPlatformSettings, updatePlatformSettings } from '../services/platformSettings.js';
import { PlatformSetting } from '../models/index.js';
import { toCsv } from '../utils/csv.js';

const MAX_FAILED = 5;
const LOCK_MS = 15 * 60 * 1000;

function sameSecret(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
const safeAdmin = (a) => (a?.toJSON ? a.toJSON() : a);
const notFound = (what) => new AppError(`${what} not found`, 404);

// ------------------------------------------------------------------ first admin (setup) and login
/** Public: tells the setup page whether the very first admin still has to be created. */
export const setupStatus = asyncHandler(async (_req, res) => {
  const count = await PlatformAdmin.estimatedDocumentCount();
  ok(res, { needsSetup: count === 0, needsCode: env.isProd, codeConfigured: Boolean(env.platformSetupCode) });
});

/**
 * POST /platform/setup - creates the FIRST admin (the founder). Only works while no admin exists.
 * In production it also needs the secret PLATFORM_SETUP_CODE (set on the server), so a stranger who finds the
 * page first cannot take over the website. On a local development database no code is needed.
 */
export const setup = asyncHandler(async (req, res) => {
  const { name, email, password, setupCode } = req.body;
  if (await PlatformAdmin.exists({})) throw new AppError('The platform is already set up. Ask an existing admin to add you, or log in.', 409, undefined, 'ALREADY_SETUP');
  if (env.isProd) {
    if (!env.platformSetupCode) throw new AppError('First-time setup needs PLATFORM_SETUP_CODE on the server. Add it in your hosting settings (environment variables), restart, and try again.', 403, { setupCode: 'Not configured on the server' });
    if (!setupCode || !sameSecret(setupCode, env.platformSetupCode)) throw new AppError('The setup code is not correct', 403, { setupCode: 'Incorrect code' });
  }
  const problem = passwordProblem(password);
  if (problem) throw new AppError(problem, 422, { password: problem });
  // Atomic lock so two people submitting at the same moment cannot both become the founder.
  try { await PlatformSetting.create({ key: 'setupDone', value: true }); } catch (e) { if (e.code === 11000) throw new AppError('The platform is already set up.', 409, undefined, 'ALREADY_SETUP'); throw e; }
  const admin = new PlatformAdmin({ name, email, isFounder: true });
  await admin.setPassword(password);
  try { await admin.save(); } catch (e) { await PlatformSetting.deleteOne({ key: 'setupDone' }); throw e; }
  setAdminCookie(res, admin);
  await platformAudit(admin, { action: 'admin.setup', targetType: 'PlatformAdmin', targetId: admin._id, summary: `${admin.name} set up the platform (first admin)` }, req.ip);
  ok(res, { admin: safeAdmin(admin) }, 201);
});

/** Public: the few platform switches the login/register pages need (login notice, can new institutions sign up). */
export const publicInfo = asyncHandler(async (_req, res) => { const s = await getPlatformSettings(); ok(res, { allowInstitutionRegistration: s.allowInstitutionRegistration, notice: s.loginNotice }); });

export const login = asyncHandler(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const admin = await PlatformAdmin.findOne({ email }).select('+passwordHash +failedLogins +lockUntil');
  if (admin?.lockUntil && admin.lockUntil > new Date()) throw new AppError('Too many wrong passwords. This admin account is locked for a few minutes; try again later or reset the password.', 429);
  const valid = admin ? await admin.checkPassword(req.body.password) : false;
  if (!valid) {
    if (admin) {
      admin.failedLogins = (admin.failedLogins || 0) + 1;
      if (admin.failedLogins >= MAX_FAILED) { admin.lockUntil = new Date(Date.now() + LOCK_MS); admin.failedLogins = 0; }
      await admin.save();
    }
    throw new AppError('Invalid email or password', 401);
  }
  if (!admin.isActive) throw new AppError('This admin account has been deactivated. Ask another admin.', 403);
  admin.failedLogins = 0;
  admin.lockUntil = undefined;
  admin.lastLoginAt = new Date();
  await admin.save();
  setAdminCookie(res, admin);
  await platformAudit(admin, { action: 'admin.login', targetType: 'PlatformAdmin', targetId: admin._id, summary: `${admin.name} logged in` }, req.ip);
  ok(res, { admin: safeAdmin(admin) });
});

export const logout = asyncHandler(async (_req, res) => { clearAdminCookie(res); ok(res, { message: 'Logged out' }); });
export const me = asyncHandler(async (req, res) => ok(res, { admin: safeAdmin(req.admin) }));

export const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const problem = passwordProblem(newPassword);
  if (problem) throw new AppError(problem, 422, { newPassword: problem });
  const admin = await PlatformAdmin.findById(req.admin._id).select('+passwordHash');
  if (!(await admin.checkPassword(currentPassword))) throw new AppError('Current password is incorrect', 400, { currentPassword: 'Incorrect' });
  if (currentPassword === newPassword) throw new AppError('Choose a password different from the current one', 422, { newPassword: 'Must be different' });
  await admin.setPassword(newPassword);
  admin.mustChangePassword = false;
  admin.tokenVersion += 1; // every other session of this admin is logged out
  await admin.save();
  setAdminCookie(res, admin); // keep this browser logged in
  await platformAudit(admin, { action: 'admin.password_changed', targetType: 'PlatformAdmin', targetId: admin._id, summary: `${admin.name} changed their password` }, req.ip);
  ok(res, { admin: safeAdmin(admin), message: 'Password changed.' });
});

export const updateMe = asyncHandler(async (req, res) => {
  const admin = await PlatformAdmin.findById(req.admin._id);
  if (req.body.name) admin.name = String(req.body.name).trim();
  await admin.save();
  ok(res, { admin: safeAdmin(admin) });
});

// ------------------------------------------------------------------ admins
export const listAdmins = asyncHandler(async (_req, res) => ok(res, (await PlatformAdmin.find({}).sort({ createdAt: 1 })).map((a) => a.toJSON())));

async function mailCredentials({ to, name, subject, intro, tempPassword, loginUrl }) {
  const r = await sendMail({ to, subject, text: `Hello ${name},\n\n${intro}\n\nLogin: ${loginUrl}\nEmail: ${to}\nTemporary password: ${tempPassword}\n\nYou will be asked to choose a new password at your first login.\n` });
  return r.sent;
}

export const createAdmin = asyncHandler(async (req, res) => {
  const email = String(req.body.email).trim().toLowerCase();
  if (await PlatformAdmin.exists({ email })) throw new AppError('An admin with this email already exists', 409, { email: 'Already an admin' });
  if (await User.exists({ email })) throw new AppError('This email already belongs to an institution account. Use a different email for the admin account.', 409, { email: 'Used by an institution account' });
  const tempPassword = generateTempPassword();
  const admin = new PlatformAdmin({ name: req.body.name, email, mustChangePassword: true, createdBy: req.admin._id });
  await admin.setPassword(tempPassword);
  await admin.save();
  const emailed = await mailCredentials({ to: email, name: admin.name, subject: 'You were added as an APMMS platform admin', intro: `${req.admin.name} added you as a platform administrator of APMMS.`, tempPassword, loginUrl: `${env.appUrl}/login` });
  await platformAudit(req.admin, { action: 'admin.created', targetType: 'PlatformAdmin', targetId: admin._id, summary: `${req.admin.name} added the admin ${admin.name} (${email})` }, req.ip);
  ok(res, { admin: safeAdmin(admin), tempPassword, emailed }, 201);
});

export const adminAction = asyncHandler(async (req, res) => {
  if (!isId(req.params.id)) throw notFound('Admin');
  const target = await PlatformAdmin.findById(req.params.id);
  if (!target) throw notFound('Admin');
  const { action } = req.body;
  const mine = sameId(target._id, req.admin._id);
  if (action === 'deactivate' || action === 'reactivate') {
    if (mine) throw new AppError('You cannot switch off your own account.', 409);
    if (target.isFounder) throw new AppError('The founding admin cannot be switched off by another admin.', 409);
    target.isActive = action === 'reactivate';
    if (action === 'deactivate') target.tokenVersion += 1; // logs them out at once
    await target.save();
    await platformAudit(req.admin, { action: `admin.${action}d`, targetType: 'PlatformAdmin', targetId: target._id, summary: `${req.admin.name} ${action}d the admin ${target.name}` }, req.ip);
    return ok(res, { admin: safeAdmin(target) });
  }
  if (action === 'reset-password') {
    if (mine) throw new AppError('Use "Change password" in My account for your own password.', 409);
    if (target.isFounder) throw new AppError('Only the founding admin can change their own password (or use the forgot-password link).', 409);
    const tempPassword = generateTempPassword();
    await target.setPassword(tempPassword);
    target.mustChangePassword = true;
    target.tokenVersion += 1;
    await target.save();
    const emailed = await mailCredentials({ to: target.email, name: target.name, subject: 'Your APMMS admin password was reset', intro: `${req.admin.name} reset your administrator password.`, tempPassword, loginUrl: `${env.appUrl}/login` });
    await platformAudit(req.admin, { action: 'admin.password_reset_by_admin', targetType: 'PlatformAdmin', targetId: target._id, summary: `${req.admin.name} reset the password of ${target.name}` }, req.ip);
    return ok(res, { admin: safeAdmin(target), tempPassword, emailed });
  }
  throw new AppError('Unknown action', 422);
});

// ------------------------------------------------------------------ overview
async function countsByInstitution() {
  const [users, groups, projects, departments] = await Promise.all([
    User.aggregate([{ $match: { deletedAt: null } }, { $group: { _id: { i: '$institution', r: '$role', a: '$approvalStatus' }, n: { $sum: 1 } } }]),
    ProjectGroup.aggregate([{ $group: { _id: '$institution', n: { $sum: 1 } } }]),
    Project.aggregate([{ $group: { _id: '$institution', n: { $sum: 1 } } }]),
    Department.aggregate([{ $group: { _id: '$institution', n: { $sum: 1 } } }]),
  ]);
  const map = new Map();
  const get = (id) => { const k = String(id); if (!map.has(k)) map.set(k, { students: 0, supervisors: 0, coordinators: 0, pendingSupervisors: 0, groups: 0, projects: 0, departments: 0 }); return map.get(k); };
  for (const u of users) {
    const c = get(u._id.i);
    if (u._id.r === 'student') c.students += u.n;
    else if (u._id.r === 'supervisor') { c.supervisors += u.n; if (u._id.a === 'pending') c.pendingSupervisors += u.n; }
    else if (u._id.r === 'coordinator') c.coordinators += u.n;
  }
  for (const g of groups) get(g._id).groups = g.n;
  for (const p of projects) get(p._id).projects = p.n;
  for (const d of departments) get(d._id).departments = d.n;
  return map;
}
const emptyCounts = { students: 0, supervisors: 0, coordinators: 0, pendingSupervisors: 0, groups: 0, projects: 0, departments: 0 };

export const overview = asyncHandler(async (_req, res) => {
  const [institutions, counts, recent, unverified, adminsCount] = await Promise.all([
    Institution.find({}).select('status').lean(),
    countsByInstitution(),
    Institution.find({}).sort({ createdAt: -1 }).limit(6).lean(),
    User.countDocuments({ role: 'coordinator', emailVerified: false, deletedAt: null, createdAt: { $lt: new Date(Date.now() - 24 * 3600 * 1000) } }),
    PlatformAdmin.countDocuments({ isActive: true }),
  ]);
  const byStatus = { pending: 0, approved: 0, rejected: 0, suspended: 0, deleted: 0 };
  for (const i of institutions) byStatus[i.status] = (byStatus[i.status] || 0) + 1;
  const totals = { ...emptyCounts };
  for (const c of counts.values()) for (const k of Object.keys(totals)) totals[k] += c[k];
  const waitingToPurge = await Institution.countDocuments({ status: 'deleted' });
  ok(res, {
    institutions: { total: institutions.length, ...byStatus },
    totals,
    recent: recent.map((i) => ({ ...i, counts: counts.get(String(i._id)) || emptyCounts })),
    attention: { coordinatorsNotVerified: unverified, deletedWaitingForErase: waitingToPurge, pendingInstitutions: byStatus.pending },
    admins: adminsCount,
  });
});

// ------------------------------------------------------------------ institutions
async function institutionRows(req) {
  const filter = {};
  if (['pending', 'approved', 'rejected', 'suspended', 'deleted'].includes(req.query.status)) filter.status = req.query.status;
  if (req.query.q) filter.name = new RegExp(escapeRegex(String(req.query.q).slice(0, 80)), 'i');
  const [list, counts] = await Promise.all([Institution.find(filter).sort({ createdAt: -1 }).lean(), countsByInstitution()]);
  const coords = await User.find({ role: 'coordinator', deletedAt: null, institution: { $in: list.map((i) => i._id) } }).select('name email institution emailVerified isActive approvalStatus lastLoginAt').lean();
  return list.map((i) => ({ ...i, counts: counts.get(String(i._id)) || emptyCounts, coordinators: coords.filter((c) => sameId(c.institution, i._id)) }));
}

export const listInstitutions = asyncHandler(async (req, res) => ok(res, await institutionRows(req)));

export const exportInstitutions = asyncHandler(async (req, res) => {
  const rows = await institutionRows(req);
  const csv = toCsv(rows, [
    { header: 'Institution', value: (r) => r.name }, { header: 'Type', value: (r) => r.type }, { header: 'Status', value: (r) => r.status },
    { header: 'Registered', value: (r) => r.createdAt }, { header: 'Coordinators', value: (r) => r.coordinators.map((c) => `${c.name} <${c.email}>`).join('; ') },
    { header: 'Students', value: (r) => r.counts.students }, { header: 'Supervisors', value: (r) => r.counts.supervisors },
    { header: 'Groups', value: (r) => r.counts.groups }, { header: 'Projects', value: (r) => r.counts.projects },
  ]);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="institutions.csv"');
  res.send(csv);
});

export const getInstitution = asyncHandler(async (req, res) => {
  if (!isId(req.params.id)) throw notFound('Institution');
  const inst = await Institution.findById(req.params.id).lean();
  if (!inst) throw notFound('Institution');
  const counts = await countsByInstitution();
  const coordinators = await User.find({ institution: inst._id, role: 'coordinator', deletedAt: null }).populate('department', 'name').select('name email coordinatorLevel department invitePending emailVerified isActive approvalStatus lastLoginAt createdAt').lean();
  const lastLogin = await User.findOne({ institution: inst._id, lastLoginAt: { $ne: null } }).sort({ lastLoginAt: -1 }).select('lastLoginAt').lean();
  ok(res, { ...inst, counts: counts.get(String(inst._id)) || emptyCounts, coordinators, lastActivityAt: lastLogin?.lastLoginAt || null });
});

const NEXT = { approve: 'approved', reject: 'rejected', suspend: 'suspended', reactivate: 'approved', restore: 'approved', purge: 'purged' };
const FROM = { approve: ['pending', 'rejected'], reject: ['pending'], suspend: ['approved'], reactivate: ['suspended'], restore: ['deleted'], purge: ['pending', 'approved', 'rejected', 'suspended', 'deleted'] };
const MAIL = {
  approve: ['Your institution is active on APMMS', (n) => `${n} is active. You can log in as Coordinator now.`],
  reject: ['Your institution request on APMMS', (n, note) => `The request for ${n} was not approved${note ? `: ${note}` : '.'}`],
  suspend: ['Your institution was switched off on APMMS', (n, note) => `Access for ${n} was switched off by the platform administrator${note ? `: ${note}` : '.'} Nothing was deleted.`],
  reactivate: ['Your institution is active again on APMMS', (n) => `Access for ${n} was switched back on.`],
  restore: ['Your institution was restored on APMMS', (n) => `${n} was restored and everything is back.`],
};

export const decideInstitution = asyncHandler(async (req, res) => {
  const { decision, note } = req.body;
  if (!isId(req.params.id)) throw notFound('Institution');
  const inst = await Institution.findById(req.params.id);
  if (!inst) throw notFound('Institution');
  if (!FROM[decision]) throw new AppError('Unknown decision', 422);
  if (!FROM[decision].includes(inst.status)) throw new AppError(`This institution is ${inst.status}, so it cannot be ${NEXT[decision]} now.`, 409);
  const name = inst.name;
  const coordinators = await User.find({ institution: inst._id, role: 'coordinator', deletedAt: null }).select('name email').lean();
  let purged;
  if (decision === 'purge') {
    purged = await purgeInstitution(inst._id);
  } else {
    inst.status = NEXT[decision];
    if (decision === 'restore') { inst.deletedAt = undefined; inst.purgeAt = undefined; }
    inst.statusNote = note || undefined;
    inst.decidedAt = new Date();
    await inst.save();
    if (decision === 'approve') {
      await User.updateMany({ institution: inst._id, role: 'coordinator', approvalStatus: 'pending', deletedAt: null }, { $set: { approvalStatus: 'approved', isActive: true } });
    } else if (decision === 'reject') {
      await User.updateMany({ institution: inst._id, role: 'coordinator', approvalStatus: 'pending', deletedAt: null }, { $set: { approvalStatus: 'rejected', approvalNote: note || undefined, isActive: false } });
    }
    if (MAIL[decision]) {
      for (const c of coordinators) await sendMail({ to: c.email, subject: MAIL[decision][0], text: `Hello ${c.name},\n\n${MAIL[decision][1](name, note)}\n${decision === 'reject' || decision === 'suspend' ? '' : `\n${env.appUrl}/login\n`}` });
    }
  }
  await platformAudit(req.admin, { action: `institution.${decision}`, targetType: 'Institution', targetId: inst._id, summary: `${req.admin.name}: ${decision} ${name}${note ? ` (${note})` : ''}` }, req.ip);
  ok(res, { institution: purged ? null : inst, purged });
});

export const updateInstitution = asyncHandler(async (req, res) => {
  if (!isId(req.params.id)) throw notFound('Institution');
  const inst = await Institution.findById(req.params.id);
  if (!inst) throw notFound('Institution');
  const { name, type } = req.body;
  if (name !== undefined) {
    const clean = String(name).trim();
    if (clean.length < 3) throw new AppError('Enter at least 3 characters', 422, { name: 'Too short' });
    const nameKey = clean.toLowerCase().replace(/\s+/g, ' ');
    if (await Institution.exists({ nameKey, _id: { $ne: inst._id }, status: { $in: ['pending', 'approved', 'suspended'] } })) throw new AppError('Another institution already has this name', 409, { name: 'Already used' });
    inst.name = clean;
    inst.nameKey = nameKey;
  }
  if (type !== undefined) { if (!INSTITUTION_TYPES.includes(type)) throw new AppError('Unknown type', 422); inst.type = type; }
  await inst.save();
  await platformAudit(req.admin, { action: 'institution.updated', targetType: 'Institution', targetId: inst._id, summary: `${req.admin.name} edited ${inst.name}` }, req.ip);
  ok(res, { institution: inst });
});

/** Admin creates an institution and its first coordinator directly (already active; temporary password is shown once). */
// Adds an institution. Its first (institution-level) coordinator can be invited right away; faculties, departments and
// department coordinators are added afterwards from the institution page.
export const createInstitution = asyncHandler(async (req, res) => {
  const { institutionName, institutionType, coordinatorName, coordinatorEmail } = req.body;
  const nameKey = String(institutionName).trim().toLowerCase().replace(/\s+/g, ' ');
  if (nameKey.length < 3) throw new AppError('Enter the institution name', 422, { institutionName: 'Too short' });
  if (await Institution.exists({ nameKey, status: { $in: ['pending', 'approved', 'suspended'] } })) throw new AppError('An institution with this name already exists', 409, { institutionName: 'Already registered' });
  if (coordinatorEmail) {
    const email = String(coordinatorEmail).trim().toLowerCase();
    if (await User.exists({ email }) || await PlatformAdmin.exists({ email })) throw new AppError('This email is already used by another account', 409, { coordinatorEmail: 'Already used' });
    if (!coordinatorName) throw new AppError('Enter the coordinator name', 422, { coordinatorName: 'Required' });
  }
  const inst = await Institution.create({ name: String(institutionName).trim(), nameKey, type: institutionType || 'university', status: 'approved', decidedAt: new Date(), statusNote: 'Created by a platform admin' });
  // Institutions added by the admin start strict: new students must be approved by their department coordinator.
  await SystemSetting.create({ institution: inst._id, key: 'requireStudentApproval', value: true });
  let invite = null;
  if (coordinatorEmail) {
    invite = await inviteCoordinator({ institution: inst, name: coordinatorName, email: coordinatorEmail, level: 'institution', invitedBy: req.admin.name });
  }
  await platformAudit(req.admin, { action: 'institution.created', targetType: 'Institution', targetId: inst._id, summary: `${req.admin.name} created ${inst.name}${invite ? ` and invited coordinator ${invite.user.email}` : ''}` }, req.ip);
  ok(res, { institution: inst, coordinator: invite ? { _id: invite.user._id, name: invite.user.name, email: invite.user.email } : null, emailed: invite?.sent, link: invite?.link }, 201);
});

const instOr404 = async (id) => {
  if (!isId(id)) throw notFound('Institution');
  const inst = await Institution.findById(id);
  if (!inst || inst.status === 'deleted') throw notFound('Institution');
  return inst;
};

export const getStructure = asyncHandler(async (req, res) => {
  const inst = await instOr404(req.params.id);
  ok(res, { ...(await structureOf(inst._id)), emailConfigured: emailConfigured() });
});

export const createFacultyFor = asyncHandler(async (req, res) => {
  const inst = await instOr404(req.params.id);
  const f = await addFaculty(inst._id, req.body);
  await platformAudit(req.admin, { action: 'faculty.created', targetType: 'Institution', targetId: inst._id, summary: `${req.admin.name} added faculty ${f.name} to ${inst.name}` }, req.ip);
  ok(res, f, 201);
});

export const updateFacultyOf = asyncHandler(async (req, res) => {
  if (!isId(req.params.id)) throw notFound('Faculty');
  const existing = await Faculty.findById(req.params.id).lean();
  if (!existing) throw notFound('Faculty');
  const f = await changeFaculty(existing.institution, req.params.id, req.body);
  await platformAudit(req.admin, { action: 'faculty.updated', targetType: 'Institution', targetId: existing.institution, summary: `${req.admin.name} updated faculty ${f.name}` }, req.ip);
  ok(res, f);
});

export const createDepartmentFor = asyncHandler(async (req, res) => {
  const inst = await instOr404(req.params.id);
  const d = await addDepartment(inst._id, req.body);
  await platformAudit(req.admin, { action: 'department.created', targetType: 'Institution', targetId: inst._id, summary: `${req.admin.name} added department ${d.name} to ${inst.name}` }, req.ip);
  ok(res, d, 201);
});

export const updateDepartmentOf = asyncHandler(async (req, res) => {
  if (!isId(req.params.id)) throw notFound('Department');
  const existing = await Department.findById(req.params.id).lean();
  if (!existing) throw notFound('Department');
  const d = await changeDepartment(existing.institution, req.params.id, req.body);
  await platformAudit(req.admin, { action: 'department.updated', targetType: 'Institution', targetId: existing.institution, summary: `${req.admin.name} updated department ${d.name}` }, req.ip);
  ok(res, d);
});

/** Invites an institution-level coordinator, or the coordinator of one department (a department has one). */
export const inviteCoordinatorFor = asyncHandler(async (req, res) => {
  const inst = await instOr404(req.params.id);
  const { name, email, level = 'department', departmentId } = req.body;
  const r = await inviteCoordinator({ institution: inst, name, email, level, departmentId, invitedBy: req.admin.name });
  await platformAudit(req.admin, { action: 'coordinator.invited', targetType: 'User', targetId: r.user._id, summary: `${req.admin.name} invited ${r.user.email} as ${level} coordinator of ${inst.name}` }, req.ip);
  ok(res, { coordinator: { _id: r.user._id, name: r.user.name, email: r.user.email }, emailed: r.sent, link: r.link }, 201);
});

export const listCoordinators = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePage(req.query, { defaultLimit: 25 });
  const filter = { role: 'coordinator', deletedAt: null };
  if (isId(req.query.institution)) filter.institution = req.query.institution;
  if (req.query.state === 'inactive') filter.isActive = false;
  if (req.query.state === 'unverified') filter.emailVerified = false;
  if (req.query.q) { const re = new RegExp(escapeRegex(String(req.query.q).slice(0, 80)), 'i'); filter.$or = [{ name: re }, { email: re }]; }
  const [items, total] = await Promise.all([
    User.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).populate('institution', 'name status').populate('department', 'name').select('name email institution department coordinatorLevel invitePending emailVerified isActive approvalStatus lastLoginAt createdAt').lean(),
    User.countDocuments(filter),
  ]);
  res.json({ success: true, data: items, meta: pageMeta(page, limit, total) });
});

export const coordinatorAction = asyncHandler(async (req, res) => {
  if (!isId(req.params.id)) throw notFound('Coordinator');
  const user = await findForVerification({ _id: req.params.id, role: 'coordinator', deletedAt: null });
  if (!user) throw notFound('Coordinator');
  const { action } = req.body;
  const label = `${user.name} (${user.email})`;
  let result = {};
  if (action === 'deactivate' || action === 'reactivate') {
    if (action === 'reactivate' && user.approvalStatus !== 'approved') throw new AppError('This coordinator has not been approved yet. Verify their email or approve the institution first.', 409);
    user.isActive = action === 'reactivate';
    if (action === 'deactivate') user.tokenVersion += 1; // logs them out at once
    await user.save();
  } else if (action === 'reset-password' || action === 'resend-invitation') {
    // No password is ever shown on screen: the coordinator gets an emailed link to choose their own.
    const inst = await Institution.findById(user.institution).select('name').lean();
    const dep = user.department ? await Department.findById(user.department).select('name').lean() : null;
    user.tokenVersion += 1;
    const r = await issueSetPasswordLink(user, { institutionName: inst?.name || 'APMMS', roleText: roleText(user, dep), invitedBy: req.admin.name, reset: action === 'reset-password' && !user.invitePending });
    result = { emailed: r.sent, link: r.link };
  } else if (action === 'resend-verification') {
    if (user.emailVerified) throw new AppError('This email is already verified.', 409);
    const mail = await issueVerificationEmail(user);
    result = { emailed: mail.sent, limited: mail.limited };
  } else if (action === 'verify-email') {
    user.emailVerified = true;
    user.emailVerifiedAt = new Date();
    user.emailVerification = {};
    await user.save();
    result = { activated: await activateNewInstitution(user, req.ip) };
  } else {
    throw new AppError('Unknown action', 422);
  }
  await platformAudit(req.admin, { action: `coordinator.${action}`, targetType: 'User', targetId: user._id, summary: `${req.admin.name}: ${action} for coordinator ${label}` }, req.ip);
  ok(res, { coordinator: { _id: user._id, name: user.name, email: user.email, isActive: user.isActive, emailVerified: user.emailVerified }, ...result });
});

// ------------------------------------------------------------------ audit log, health, settings
export const listAudit = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePage(req.query, { defaultLimit: 30 });
  const filter = {};
  if (req.query.action) filter.action = new RegExp(`^${escapeRegex(String(req.query.action).slice(0, 40))}`);
  if (req.query.q) filter.summary = new RegExp(escapeRegex(String(req.query.q).slice(0, 80)), 'i');
  const [items, total] = await Promise.all([PlatformAudit.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(), PlatformAudit.countDocuments(filter)]);
  res.json({ success: true, data: items, meta: pageMeta(page, limit, total) });
});

function dirSize(dir) {
  let total = 0;
  let files = 0;
  const walk = (d) => {
    let entries = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else { try { total += fs.statSync(p).size; files += 1; } catch { /* ignore */ } }
    }
  };
  walk(dir);
  return { bytes: total, files };
}

export const health = asyncHandler(async (_req, res) => {
  const conn = mongoose.connection;
  const mem = process.memoryUsage();
  ok(res, {
    status: conn.readyState === 1 ? 'ok' : 'database-down',
    database: { state: ['disconnected', 'connected', 'connecting', 'disconnecting'][conn.readyState] || 'unknown', host: conn.host, name: conn.name },
    server: { node: process.version, environment: env.nodeEnv, uptimeSeconds: Math.round(process.uptime()), memoryMB: Math.round(mem.rss / 1048576), time: new Date().toISOString() },
    email: { configured: emailConfigured(), from: env.emailFrom },
    appUrl: env.appUrl,
    uploads: dirSize(env.uploadDir),
    purgeDays: env.institutionPurgeDays,
    setupCodeConfigured: Boolean(env.platformSetupCode),
    persistentStorageWarning: env.isProd ? 'Uploaded files are stored on the server disk. On hosts without a persistent disk (for example the free Render plan) they are lost when the server restarts or redeploys.' : null,
  });
});

export const getSettings = asyncHandler(async (_req, res) => ok(res, await getPlatformSettings()));
export const putSettings = asyncHandler(async (req, res) => {
  const next = await updatePlatformSettings(req.body);
  await platformAudit(req.admin, { action: 'platform.settings_changed', summary: `${req.admin.name} changed platform settings (new institution sign-up: ${next.allowInstitutionRegistration ? 'on' : 'off'})` }, req.ip);
  ok(res, next);
});
