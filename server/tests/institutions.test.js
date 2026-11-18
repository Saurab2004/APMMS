// Multi-institution workspaces: sign-up, automatic activation, platform-admin control, and - most important - isolation.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, stopTestServer, Client, loggedIn, latestToken, outbox, adminLoggedIn, createInstitutionViaAdmin } from './helpers.js';
import { User, Institution, Project, Department } from '../models/index.js';
import { runUnscoped } from '../utils/tenant.js';

before(startTestServer);
after(stopTestServer);
const anon = () => new Client();
const PW = 'Passw0rd1';
const S = {};

const verify = (email) => anon().post('/api/auth/verify-email', { token: latestToken(email) });
const opts = async () => (await anon().get('/api/auth/registration-options')).body.data;

test('institutions are added by the platform admin; coordinators are invited by email and cannot sign up', async () => {
  const before = await opts();
  assert.deepEqual(before.institutions.map((i) => i.name), ['Demo University']);
  assert.equal(before.platform.allowInstitutionRegistration, undefined, 'there is no institution sign-up any more');
  S.admin = await adminLoggedIn();

  // nobody can sign up as a coordinator, with or without an institution name
  const r = await anon().post('/api/auth/register', { name: 'Dr. Beta Boss', email: 'beta@beta.test', password: PW, role: 'coordinator', institutionName: 'Beta College' });
  assert.equal(r.status, 422);
  assert.ok(!(await User.exists({ email: 'beta@beta.test' })));

  // the admin adds the institution, a faculty, a department and invites the coordinator
  const made = await S.admin.post('/api/platform/institutions', { institutionName: 'Beta College', institutionType: 'college', coordinatorName: 'Dr. Beta Boss', coordinatorEmail: 'beta@beta.test' });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  assert.equal(made.body.data.tempPassword, undefined, 'no password is ever shown');
  assert.match(made.body.data.link, /reset-password\?token=/, 'with no SMTP configured the admin gets the link to pass on');
  S.betaId = made.body.data.institution._id;
  S.betaFaculty = (await S.admin.post(`/api/platform/institutions/${S.betaId}/faculties`, { name: 'Faculty of Computing' })).body.data._id;
  assert.equal((await S.admin.post(`/api/platform/institutions/${S.betaId}/faculties`, { name: 'faculty of computing' })).status, 201, 'names are compared exactly');
  assert.equal((await S.admin.post(`/api/platform/institutions/${S.betaId}/faculties`, { name: 'Faculty of Computing' })).status, 409, 'duplicate faculty');
  assert.equal((await S.admin.post(`/api/platform/institutions/${S.betaId}/departments`, { name: 'Computer Science & Engineering', code: 'CSE' })).status, 422, 'a department needs a faculty');
  const dep = await S.admin.post(`/api/platform/institutions/${S.betaId}/departments`, { name: 'Computer Science & Engineering', code: 'CSE', facultyId: S.betaFaculty });
  assert.equal(dep.status, 201, JSON.stringify(dep.body));
  S.betaDept = dep.body.data._id;

  // not offered to students before it has a department, and the coordinator cannot log in before choosing a password
  const early = await anon().post('/api/auth/login', { email: 'beta@beta.test', password: PW, role: 'coordinator' });
  assert.equal(early.status, 401);
  // the emailed link sets the password (and proves the email address); it works once
  const token = latestToken('beta@beta.test');
  assert.ok(outbox.find((m) => m.to === 'beta@beta.test').text.includes('/reset-password?token='));
  assert.equal((await anon().post('/api/auth/reset-password', { token, password: PW })).status, 200);
  assert.equal((await anon().post('/api/auth/reset-password', { token, password: 'Other1234' })).status, 400);
  const login = await anon().post('/api/auth/login', { email: 'beta@beta.test', password: PW, role: 'coordinator' });
  assert.equal(login.status, 200, JSON.stringify(login.body));
  // the same institution name cannot be added twice
  assert.equal((await S.admin.post('/api/platform/institutions', { institutionName: 'BETA COLLEGE' })).status, 409);
});

test('only a platform admin can list and decide institutions; a coordinator never touches another institution', async () => {
  S.owner = await loggedIn('coordinator@apmms.test'); // the Demo University coordinator
  S.aliceC = await loggedIn('alice@apmms.test');
  assert.equal((await S.aliceC.get('/api/platform/institutions')).status, 401, 'an institution user has no platform access');
  assert.equal((await S.owner.get('/api/platform/institutions')).status, 401, 'not even a coordinator');
  const list = await S.admin.get('/api/platform/institutions?status=approved');
  assert.equal(list.status, 200);
  const beta = list.body.data.find((i) => i.name === 'Beta College');
  assert.ok(beta, 'Beta College is already active');
  assert.equal(beta.coordinators[0].email, 'beta@beta.test');
  // an active institution cannot be "reactivated"
  assert.equal((await S.admin.post(`/api/platform/institutions/${beta._id}/decision`, { decision: 'reactivate' })).status, 409);
  assert.equal(S.betaId, beta._id);
  S.betaC = await loggedIn('beta@beta.test', 'coordinator', PW);
  assert.equal((await S.betaC.get('/api/platform/institutions')).status, 401, 'an institution coordinator is not a platform admin');
  assert.equal((await S.betaC.post(`/api/platform/institutions/${beta._id}/decision`, { decision: 'suspend' })).status, 401, 'and cannot decide about institutions');
  assert.equal((await S.betaC.get('/api/auth/me')).body.data.user.institution.name, 'Beta College');
  assert.deepEqual((await opts()).institutions.map((i) => i.name).sort(), ['Beta College', 'Demo University']);
});

test('students and supervisors join the institution they choose; departments cannot be mixed up', async () => {
  const o = await opts();
  const beta = o.institutions.find((i) => i.name === 'Beta College');
  const demo = o.institutions.find((i) => i.name === 'Demo University');
  assert.equal(beta.departments.length, 1, 'the department the admin added');
  assert.equal(beta.faculties.length, 2);
  assert.equal(String(beta.departments[0].faculty), String(S.betaFaculty));
  // wrong department for the chosen institution
  const bad = await anon().post('/api/auth/register', { name: 'Mix Up', email: 'mix@beta.test', password: PW, role: 'student', studentId: 'B-1', institutionId: beta._id, facultyId: demo.departments[0].faculty, departmentId: demo.departments[0]._id, batchId: demo.departments[0].batches[0]?._id });
  assert.equal(bad.status, 422);
  // same student id and same department name may exist in two institutions
  // a faculty has to be chosen, and it has to match the department
  const noFaculty = await anon().post('/api/auth/register', { name: 'No Fac', email: 'nofac@beta.test', password: PW, role: 'student', studentId: 'B-2', institutionId: beta._id, departmentId: beta.departments[0]._id });
  assert.equal(noFaculty.status, 422);
  const wrongFaculty = await anon().post('/api/auth/register', { name: 'Wrong Fac', email: 'wrongfac@beta.test', password: PW, role: 'student', studentId: 'B-3', institutionId: beta._id, facultyId: beta.faculties.find((f) => f._id !== S.betaFaculty)._id, departmentId: beta.departments[0]._id });
  assert.equal(wrongFaculty.status, 422);
  for (const [inst, email] of [[demo, 'sid@demo.test'], [beta, 'sid@beta.test']]) {
    const r = await anon().post('/api/auth/register', { name: 'Same Id', email, password: PW, role: 'student', studentId: 'SAME-001', institutionId: inst._id, facultyId: inst.departments[0].faculty, departmentId: inst.departments[0]._id, batchId: inst.departments[0].batches[0]?._id });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    await verify(email);
  }
  assert.equal((await anon().post('/api/auth/register', { name: 'Dup', email: 'dup@beta.test', password: PW, role: 'student', studentId: 'SAME-001', institutionId: beta._id, facultyId: beta.departments[0].faculty, departmentId: beta.departments[0]._id })).status, 409, 'duplicate inside one institution');
  // a supervisor request reaches only that institution's coordinator
  const sup = await anon().post('/api/auth/register', { name: 'Beta Sup', email: 'sup@beta.test', password: PW, role: 'supervisor', institutionId: beta._id, facultyId: beta.departments[0].faculty, departmentId: beta.departments[0]._id });
  assert.equal(sup.status, 201);
  await verify('sup@beta.test');
  assert.ok((await S.betaC.get('/api/notifications')).body.data.some((n) => n.type === 'approval_request'));
  assert.ok(!(await S.owner.get('/api/notifications')).body.data.some((n) => /Beta Sup/.test(n.body || '')), 'the Demo coordinator is not told');
  // institutions added by the admin start strict: the student is waiting for approval too
  const pending = await S.betaC.get('/api/users?approval=pending');
  assert.equal(pending.body.data.length, 2, 'the supervisor and the student');
  assert.equal((await anon().post('/api/auth/login', { email: 'sid@beta.test', password: PW, role: 'student' })).status, 403, 'a pending student cannot log in');
  // Demo coordinator cannot decide a Beta user
  assert.equal((await S.owner.post(`/api/users/${pending.body.data[0]._id}/approval`, { decision: 'approve' })).status, 404);
  for (const u of pending.body.data) assert.equal((await S.betaC.post(`/api/users/${u._id}/approval`, { decision: 'approve' })).status, 200);
  assert.equal((await anon().post('/api/auth/login', { email: 'sid@beta.test', password: PW, role: 'student' })).status, 200, 'approved, so now they can log in');
});

test('ISOLATION: users, departments, settings, rubrics and audit logs are separate', async () => {
  const names = async (c, url) => (await c.get(url)).body.data.map((u) => u.email);
  const demoUsers = await names(S.owner, '/api/users?limit=100');
  const betaUsers = await names(S.betaC, '/api/users?limit=100');
  assert.ok(demoUsers.includes('alice@apmms.test') && !demoUsers.some((e) => e.endsWith('@beta.test')));
  assert.ok(betaUsers.includes('beta@beta.test') && !betaUsers.some((e) => e.endsWith('@apmms.test')));

  // one coordinator cannot touch another institution's user (404, as if it did not exist)
  const alice = (await User.findOne({ email: 'alice@apmms.test' }))._id;
  assert.equal((await S.betaC.patch(`/api/users/${alice}/status`, { isActive: false })).status, 404);
  assert.equal((await S.betaC.post(`/api/users/${alice}/reset-password`, {})).status, 404);

  // departments: own list only; an `institution` field in the body is ignored
  const deps = async (c) => (await c.get('/api/departments')).body.data;
  const demoInst = (await S.owner.get('/api/auth/me')).body.data.user.institution._id;
  const created = await S.betaC.post('/api/departments', { name: 'Physics', code: 'PHY', facultyId: S.betaFaculty, institution: demoInst });
  assert.equal(created.status, 201);
  assert.equal(String(created.body.data.institution), String(S.betaId), 'forced into the caller\'s institution');
  assert.deepEqual((await deps(S.betaC)).map((d) => d.code).sort(), ['CSE', 'PHY']);
  assert.ok(!(await deps(S.owner)).some((d) => d.code === 'PHY'));
  // same department name in both institutions is fine
  const demoFaculty = (await S.owner.get('/api/faculties')).body.data[0]._id;
  assert.equal((await S.betaC.post('/api/departments', { name: 'Maths', code: 'MTH', facultyId: S.betaFaculty })).status, 201);
  assert.equal((await S.owner.post('/api/departments', { name: 'Maths', code: 'MTH', facultyId: demoFaculty })).status, 201);
  assert.equal((await S.betaC.post('/api/departments', { name: 'Maths', code: 'MTH2', facultyId: S.betaFaculty })).status, 409, 'duplicate inside Beta');
  assert.equal((await S.betaC.post('/api/departments', { name: 'Chemistry', code: 'CHM', facultyId: demoFaculty })).status, 422, 'a faculty of another institution is refused');

  // settings are per institution
  assert.equal((await S.betaC.put('/api/settings', { maxGroupSize: 2 })).status, 200);
  assert.equal((await S.betaC.get('/api/settings')).body.data.settings.maxGroupSize, 2);
  assert.equal((await S.owner.get('/api/settings')).body.data.settings.maxGroupSize, 4);

  // rubrics (seeded only for Demo) are invisible to Beta
  assert.ok((await S.owner.get('/api/evaluations/rubrics')).body.data.length >= 2);
  assert.equal((await S.betaC.get('/api/evaluations/rubrics')).body.data.length, 0);

  // audit logs and analytics
  const betaLogs = (await S.betaC.get('/api/audit-logs?limit=100')).body.data;
  assert.ok(betaLogs.length > 0 && betaLogs.every((l) => !/alice|Demo/i.test(l.summary || '')));
  const a1 = (await S.owner.get('/api/analytics')).body.data;
  const a2 = (await S.betaC.get('/api/analytics')).body.data;
  assert.ok(!JSON.stringify(a2).includes('Sam Supervisor') && !JSON.stringify(a1).includes('Beta Sup'), 'analytics only count their own people');
});

const gid = (g) => String(g._id ?? g.id);
test('ISOLATION: groups, join codes, projects and supervisor assignment', async () => {
  const alice = await loggedIn('alice@apmms.test');
  const g = await alice.post('/api/groups', { name: 'Shared Name' });
  assert.equal(g.status, 201, JSON.stringify(g.body));
  const demoGroup = (await alice.get('/api/groups/mine')).body.data.current.group;
  const projectId = (await alice.get('/api/projects/mine')).body.data.projectId;

  // a new institution must configure its own academic term first
  const y = new Date().getFullYear();
  const term = await S.betaC.post('/api/academic-terms', { name: `Fall ${y}`, academicYear: `${y}-${y + 1}`, semester: 'Fall', startDate: `${y}-01-01`, endDate: `${y + 1}-12-31`, isCurrent: true });
  assert.equal(term.status, 201, JSON.stringify(term.body));
  const betaStudent = await loggedIn('sid@beta.test', 'student', PW);
  // Beta student cannot use a Demo join code, and can create the same group name in their own institution
  assert.equal((await betaStudent.post('/api/groups/join', { code: demoGroup.code })).status, 404);
  const bg = await betaStudent.post('/api/groups', { name: 'Shared Name' });
  assert.equal(bg.status, 201, JSON.stringify(bg.body));
  bg.body.data = (await betaStudent.get('/api/groups/mine')).body.data.current.group;
  assert.equal((await betaStudent.get(`/api/groups/${gid(demoGroup)}`)).status, 404);
  assert.equal((await alice.get(`/api/groups/${gid(bg.body.data)}`)).status, 404);
  const betaProject = (await betaStudent.get('/api/projects/mine')).body.data.projectId;

  // coordinators only see their own
  const ids = async (c, url) => (await c.get(url)).body.data.map((x) => String(x._id));
  const demoList = await ids(S.owner, '/api/groups');
  const betaList = await ids(S.betaC, '/api/groups');
  assert.equal(demoList.length, 1);
  assert.equal(betaList.length, 1);
  assert.notEqual(demoList[0], betaList[0]);
  assert.equal(demoList[0], gid(demoGroup));
  assert.deepEqual(await ids(S.owner, '/api/projects'), [String(projectId)]);
  assert.deepEqual(await ids(S.betaC, '/api/projects'), [String(betaProject)]);
  assert.equal((await S.betaC.get(`/api/projects/${projectId}`)).status, 404, 'other institution project');
  assert.equal((await S.owner.get(`/api/projects/${betaProject}`)).status, 404);

  // a coordinator cannot assign a supervisor from another institution
  const demoSup = (await User.findOne({ email: 'supervisor@apmms.test' }))._id;
  assert.equal((await S.betaC.put(`/api/projects/${betaProject}/supervisor`, { supervisorId: String(demoSup) })).status, 404);
  // nor create a user inside another institution's department
  const demoDep = (await Department.findOne({ code: 'CSE', institution: demoInstId() }))?._id;
  const cu = await S.betaC.post('/api/users', { name: 'Leak', email: 'leak@beta.test', role: 'student', studentId: 'L-1', departmentId: String(demoDep) });
  assert.ok([404, 422].includes(cu.status), `got ${cu.status}`);
  assert.equal((await alice.get('/api/auth/me')).body.data.user.institution.name, 'Demo University');
});
function demoInstId() { return S.demoInst; }

test('suspending an institution blocks its people at once; reactivating restores them', async () => {
  S.demoInst = (await S.owner.get('/api/auth/me')).body.data.user.institution._id;
  const betaStudent = await loggedIn('sid@beta.test', 'student', PW);
  assert.equal((await betaStudent.get('/api/auth/me')).status, 200);
  assert.equal((await S.admin.post(`/api/platform/institutions/${S.betaId}/decision`, { decision: 'suspend', note: 'test' })).status, 200);
  assert.equal((await betaStudent.get('/api/auth/me')).status, 403, 'existing session blocked');
  assert.equal((await S.betaC.get('/api/users')).status, 403);
  const login = await anon().post('/api/auth/login', { email: 'sid@beta.test', password: PW, role: 'student' });
  assert.equal(login.status, 403);
  assert.match(login.body.message, /switched off/);
  assert.deepEqual((await opts()).institutions.map((i) => i.name), ['Demo University'], 'not offered for sign-up while suspended');
  // the other institution is unaffected
  assert.equal((await (await loggedIn('alice@apmms.test')).get('/api/auth/me')).status, 200);
  assert.equal((await S.admin.post(`/api/platform/institutions/${S.betaId}/decision`, { decision: 'reactivate' })).status, 200);
  assert.equal((await betaStudent.get('/api/auth/me')).status, 200);
});

test('a platform admin can erase an institution for good, with its files; others stay untouched', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const env = (await import('../config/env.js')).default;
  const { form, pdfBlob } = await import('./helpers.js');
  const { Department } = await import('../models/index.js');

  const made = await createInstitutionViaAdmin(S.admin, { name: 'Gamma Institute', coordinator: { name: 'Gamma Head', email: 'gamma@gamma.test' } });
  const g = await loggedIn('gamma@gamma.test', 'coordinator', PW);
  assert.equal((await g.get('/api/departments')).body.data.length, 1);
  const up = await g.call('POST', '/api/repository', form({ title: 'Gamma file', category: 'template' }, { file: { blob: pdfBlob('gamma'), name: 'g.pdf' } }));
  assert.equal(up.status, 201, JSON.stringify(up.body));
  const stored = path.resolve(env.uploadDir, up.body.data.file.storagePath);
  assert.ok(fs.existsSync(stored));

  // a coordinator can no longer delete the institution; only the platform admin can
  assert.equal((await g.post('/api/institutions/mine/delete', { password: PW, confirmName: 'Gamma Institute' })).status, 404);
  assert.equal((await S.admin.post(`/api/platform/institutions/${made.instId}/decision`, { decision: 'purge' })).status, 200);
  assert.equal(await Institution.countDocuments({ _id: made.instId }), 0);
  assert.equal(await runUnscoped(() => User.countDocuments({ institution: made.instId })), 0);
  assert.equal(await runUnscoped(() => Department.countDocuments({ institution: made.instId })), 0);
  assert.ok(!fs.existsSync(stored), 'uploaded file removed from disk');
  assert.ok(await User.exists({ email: 'alice@apmms.test' }), 'Demo University data intact');
  // the same name and email can be used again at once
  const again = await createInstitutionViaAdmin(S.admin, { name: 'Gamma Institute', coordinator: { name: 'Gamma Head', email: 'gamma@gamma.test' } });
  assert.ok(again.instId);
});

test('migration moves records created before institutions existed into one Default Institution', async () => {
  const mongoose = (await import('mongoose')).default;
  const { migrateToInstitutions } = await import('../services/migration.js');
  // simulate an old database: raw documents without an institution
  await runUnscoped(async () => { await User.deleteMany({}); await Institution.deleteMany({}); });
  const hash = 'not-a-real-hash';
  await User.collection.insertMany([
    { name: 'Old Coord', email: 'oldc@old.test', role: 'coordinator', isActive: true, approvalStatus: 'approved', passwordHash: hash, createdAt: new Date(1) },
    { name: 'Old Student', email: 'olds@old.test', role: 'student', isActive: true, approvalStatus: 'approved', passwordHash: hash, studentId: 'O-1', createdAt: new Date(2) },
  ]);
  await mongoose.connection.collection('departments').insertOne({ name: 'Old Dept', code: 'OLD', isActive: true });
  await migrateToInstitutions({ log: () => {} });
  const inst = await Institution.find({});
  assert.equal(inst.length, 1);
  assert.equal(inst[0].name, 'Default Institution');
  assert.equal(inst[0].status, 'approved');
  const users = await runUnscoped(() => User.find({}).lean());
  assert.ok(users.every((u) => String(u.institution) === String(inst[0]._id)));
  assert.ok(users.every((u) => u.isPlatformOwner === undefined), 'the old platform-owner flag is gone');
  const dep = await mongoose.connection.collection('departments').findOne({ code: 'OLD' });
  assert.equal(String(dep.institution), String(inst[0]._id));
  // running it again changes nothing
  await migrateToInstitutions({ log: () => {} });
  assert.equal(await Institution.countDocuments({}), 1);
});
