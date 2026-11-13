// Multi-institution workspaces: sign-up, platform-owner approval, and - most important - isolation.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, stopTestServer, Client, loggedIn, latestToken, outbox } from './helpers.js';
import { User, Institution, Project, Department } from '../models/index.js';
import { runUnscoped } from '../utils/tenant.js';

before(startTestServer);
after(stopTestServer);
const anon = () => new Client();
const PW = 'Passw0rd1';
const S = {};

const verify = (email) => anon().post('/api/auth/verify-email', { token: latestToken(email) });
const opts = async () => (await anon().get('/api/auth/registration-options')).body.data;

test('a new coordinator registers an institution; it waits for the platform owner', async () => {
  const before = await opts();
  assert.deepEqual(before.institutions.map((i) => i.name), ['Demo University']);
  assert.equal(before.platform.needsSetup, false);

  const r = await anon().post('/api/auth/register', { name: 'Dr. Beta Boss', email: 'beta@beta.test', password: PW, role: 'coordinator', institutionName: 'Beta College', institutionType: 'college', departmentName: 'Computer Science & Engineering' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.data.pending, true);
  assert.equal(r.body.data.user, undefined, 'no instant login');
  // not listed for students until approved
  assert.deepEqual((await opts()).institutions.map((i) => i.name), ['Demo University']);

  // verified email alone is not enough
  assert.equal((await verify('beta@beta.test')).status, 200);
  const login = await anon().post('/api/auth/login', { email: 'beta@beta.test', password: PW, role: 'coordinator' });
  assert.equal(login.status, 403);
  assert.match(login.body.message, /platform administrator/);
  // a copy-cat name is refused
  assert.equal((await anon().post('/api/auth/register', { name: 'Copy Cat', email: 'x@x.test', password: PW, role: 'coordinator', institutionName: 'BETA COLLEGE' })).status, 409);
});

test('only the platform owner can list and decide institutions', async () => {
  S.owner = await loggedIn('coordinator@apmms.test');
  S.aliceC = await loggedIn('alice@apmms.test');
  assert.equal((await S.aliceC.get('/api/institutions')).status, 403);
  const list = await S.owner.get('/api/institutions?status=pending');
  assert.equal(list.status, 200);
  assert.equal(list.body.data.length, 1);
  const beta = list.body.data[0];
  assert.equal(beta.name, 'Beta College');
  assert.equal(beta.coordinators[0].email, 'beta@beta.test');
  assert.ok((await S.owner.get('/api/notifications')).body.data.some((n) => n.title === 'New institution waiting for approval'));
  // the owner cannot suspend their own institution
  const mine = (await S.owner.get('/api/institutions')).body.data.find((i) => i.isMine);
  assert.equal((await S.owner.post(`/api/institutions/${mine._id}/decision`, { decision: 'suspend' })).status, 409);
  // pending -> cannot be "reactivated"
  assert.equal((await S.owner.post(`/api/institutions/${beta._id}/decision`, { decision: 'reactivate' })).status, 409);
  assert.equal((await S.owner.post(`/api/institutions/${beta._id}/decision`, { decision: 'approve' })).status, 200);
  S.betaId = beta._id;
  S.betaC = await loggedIn('beta@beta.test', 'coordinator', PW);
  assert.equal((await S.betaC.get('/api/institutions')).status, 403, 'an approved coordinator is not a platform owner');
  assert.equal((await S.betaC.get('/api/auth/me')).body.data.user.institution.name, 'Beta College');
  assert.deepEqual((await opts()).institutions.map((i) => i.name).sort(), ['Beta College', 'Demo University']);
});

test('students and supervisors join the institution they choose; departments cannot be mixed up', async () => {
  const o = await opts();
  const beta = o.institutions.find((i) => i.name === 'Beta College');
  const demo = o.institutions.find((i) => i.name === 'Demo University');
  assert.equal(beta.departments.length, 1, 'the first department made at sign-up');
  // wrong department for the chosen institution
  const bad = await anon().post('/api/auth/register', { name: 'Mix Up', email: 'mix@beta.test', password: PW, role: 'student', studentId: 'B-1', institutionId: beta._id, departmentId: demo.departments[0]._id });
  assert.equal(bad.status, 422);
  // same student id and same department name may exist in two institutions
  for (const [inst, email] of [[demo, 'sid@demo.test'], [beta, 'sid@beta.test']]) {
    const r = await anon().post('/api/auth/register', { name: 'Same Id', email, password: PW, role: 'student', studentId: 'SAME-001', institutionId: inst._id, departmentId: inst.departments[0]._id });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    await verify(email);
  }
  assert.equal((await anon().post('/api/auth/register', { name: 'Dup', email: 'dup@beta.test', password: PW, role: 'student', studentId: 'SAME-001', institutionId: beta._id, departmentId: beta.departments[0]._id })).status, 409, 'duplicate inside one institution');
  // a supervisor request reaches only that institution's coordinator
  const sup = await anon().post('/api/auth/register', { name: 'Beta Sup', email: 'sup@beta.test', password: PW, role: 'supervisor', institutionId: beta._id, departmentId: beta.departments[0]._id });
  assert.equal(sup.status, 201);
  await verify('sup@beta.test');
  assert.ok((await S.betaC.get('/api/notifications')).body.data.some((n) => n.type === 'approval_request'));
  assert.ok(!(await S.owner.get('/api/notifications')).body.data.some((n) => /Beta Sup/.test(n.body || '')), 'the Demo coordinator is not told');
  const pending = await S.betaC.get('/api/users?approval=pending');
  assert.equal(pending.body.data.length, 1);
  assert.equal((await S.betaC.post(`/api/users/${pending.body.data[0]._id}/approval`, { decision: 'approve' })).status, 200);
  // Demo coordinator cannot decide a Beta user
  assert.equal((await S.owner.post(`/api/users/${pending.body.data[0]._id}/approval`, { decision: 'approve' })).status, 404);
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
  const created = await S.betaC.post('/api/departments', { name: 'Physics', code: 'PHY', institution: demoInst });
  assert.equal(created.status, 201);
  assert.equal(String(created.body.data.institution), String(S.betaId), 'forced into the caller\'s institution');
  assert.deepEqual((await deps(S.betaC)).map((d) => d.code).sort(), ['CSE', 'PHY']);
  assert.ok(!(await deps(S.owner)).some((d) => d.code === 'PHY'));
  // same department name in both institutions is fine
  assert.equal((await S.betaC.post('/api/departments', { name: 'Maths', code: 'MTH' })).status, 201);
  assert.equal((await S.owner.post('/api/departments', { name: 'Maths', code: 'MTH' })).status, 201);
  assert.equal((await S.betaC.post('/api/departments', { name: 'Maths 2', code: 'MTH' })).status, 409, 'duplicate inside Beta');

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
  assert.equal((await S.owner.post(`/api/institutions/${S.betaId}/decision`, { decision: 'suspend', note: 'test' })).status, 200);
  assert.equal((await betaStudent.get('/api/auth/me')).status, 403, 'existing session blocked');
  assert.equal((await S.betaC.get('/api/users')).status, 403);
  const login = await anon().post('/api/auth/login', { email: 'sid@beta.test', password: PW, role: 'student' });
  assert.equal(login.status, 403);
  assert.match(login.body.message, /switched off/);
  assert.deepEqual((await opts()).institutions.map((i) => i.name), ['Demo University'], 'not offered for sign-up while suspended');
  // the other institution is unaffected
  assert.equal((await (await loggedIn('alice@apmms.test')).get('/api/auth/me')).status, 200);
  assert.equal((await S.owner.post(`/api/institutions/${S.betaId}/decision`, { decision: 'reactivate' })).status, 200);
  assert.equal((await betaStudent.get('/api/auth/me')).status, 200);
});

test('rejecting an institution request keeps it out', async () => {
  await anon().post('/api/auth/register', { name: 'Nope', email: 'nope@nope.test', password: PW, role: 'coordinator', institutionName: 'Nope Institute' });
  await verify('nope@nope.test');
  const nope = (await S.owner.get('/api/institutions?status=pending')).body.data[0];
  assert.equal((await S.owner.post(`/api/institutions/${nope._id}/decision`, { decision: 'reject', note: 'Cannot verify' })).status, 200);
  const login = await anon().post('/api/auth/login', { email: 'nope@nope.test', password: PW, role: 'coordinator' });
  assert.equal(login.status, 403);
  // the name can be requested again after a rejection
  assert.equal((await anon().post('/api/auth/register', { name: 'Nope Two', email: 'nope2@nope.test', password: PW, role: 'coordinator', institutionName: 'Nope Institute' })).status, 201);
});

test('a coordinator can delete their own institution: blocked at once, restorable, or erased for good', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const env = (await import('../config/env.js')).default;
  const { form, pdfBlob } = await import('./helpers.js');
  const { purgeDueInstitutions } = await import('../services/institutionPurge.js');
  const { Department } = await import('../models/index.js');

  const reg = await anon().post('/api/auth/register', { name: 'Gamma Head', email: 'gamma@gamma.test', password: PW, role: 'coordinator', institutionName: 'Gamma Institute' });
  assert.equal(reg.status, 201);
  await verify('gamma@gamma.test');
  const gamma = (await S.owner.get('/api/institutions?status=pending')).body.data.find((i) => i.name === 'Gamma Institute');
  await S.owner.post(`/api/institutions/${gamma._id}/decision`, { decision: 'approve' });
  const g = await loggedIn('gamma@gamma.test', 'coordinator', PW);
  // Gamma gets data of its own, including an uploaded file
  assert.equal((await g.post('/api/departments', { name: 'Gamma Dept', code: 'GD' })).status, 201);
  const up = await g.call('POST', '/api/repository', form({ title: 'Gamma file', category: 'template' }, { file: { blob: pdfBlob('gamma'), name: 'g.pdf' } }));
  assert.equal(up.status, 201, JSON.stringify(up.body));
  const stored = path.resolve(env.uploadDir, up.body.data.file.storagePath);
  assert.ok(fs.existsSync(stored));

  const body = { password: PW, confirmName: 'Gamma Institute' };
  assert.equal((await g.post('/api/institutions/mine/delete', { ...body, password: 'wrong-pass' })).status, 422);
  assert.equal((await g.post('/api/institutions/mine/delete', { ...body, confirmName: 'Gamma' })).status, 422);
  assert.equal((await (await loggedIn('alice@apmms.test')).post('/api/institutions/mine/delete', body)).status, 403, 'students cannot');
  // the institution holding the only platform owner is protected
  const protectedTry = await S.owner.post('/api/institutions/mine/delete', { password: 'Demo@12345', confirmName: 'Demo University' });
  assert.equal(protectedTry.status, 409);
  assert.equal(protectedTry.body.code ?? protectedTry.body.error?.code, 'LAST_PLATFORM_OWNER');

  // 1) normal delete: blocked immediately, hidden, data kept for the grace period
  const del = await g.post('/api/institutions/mine/delete', body);
  assert.equal(del.status, 200, JSON.stringify(del.body));
  assert.equal(del.body.data.erased, false);
  assert.equal((await g.get('/api/auth/me')).status, 401, 'cookie cleared');
  const relog = await anon().post('/api/auth/login', { email: 'gamma@gamma.test', password: PW, role: 'coordinator' });
  assert.equal(relog.status, 403);
  assert.match(relog.body.message, /deleted/);
  assert.ok(!(await opts()).institutions.some((i) => i.name === 'Gamma Institute'));
  const row = (await S.owner.get('/api/institutions')).body.data.find((i) => i._id === gamma._id);
  assert.equal(row.status, 'deleted');
  assert.ok(new Date(row.purgeAt) > new Date());
  assert.ok(fs.existsSync(stored), 'files kept during the grace period');
  // other institutions are untouched
  assert.equal((await (await loggedIn('alice@apmms.test')).get('/api/auth/me')).status, 200);
  // the platform owner can restore it
  assert.equal((await S.owner.post(`/api/institutions/${gamma._id}/decision`, { decision: 'restore' })).status, 200);
  const g2 = await loggedIn('gamma@gamma.test', 'coordinator', PW);
  assert.equal((await g2.get('/api/departments')).body.data.length, 1, 'data came back with it');

  // 2) after the grace period the timer erases it
  assert.equal((await g2.post('/api/institutions/mine/delete', body)).status, 200);
  await runUnscoped(() => Institution.updateOne({ _id: gamma._id }, { $set: { purgeAt: new Date(Date.now() - 1000) } }));
  assert.equal(await purgeDueInstitutions(), 1);
  assert.equal(await Institution.countDocuments({ _id: gamma._id }), 0);
  assert.equal(await runUnscoped(() => User.countDocuments({ institution: gamma._id })), 0);
  assert.equal(await runUnscoped(() => Department.countDocuments({ institution: gamma._id })), 0);
  assert.ok(!fs.existsSync(stored), 'uploaded file removed from disk');
  assert.ok(await User.exists({ email: 'alice@apmms.test' }), 'Demo University data intact');

  // 3) erase immediately: the email can be used again at once, and the name too
  const again = await anon().post('/api/auth/register', { name: 'Gamma Head', email: 'gamma@gamma.test', password: PW, role: 'coordinator', institutionName: 'Gamma Institute' });
  assert.equal(again.status, 201);
  await verify('gamma@gamma.test');
  const g3i = (await S.owner.get('/api/institutions?status=pending')).body.data.find((i) => i.name === 'Gamma Institute');
  await S.owner.post(`/api/institutions/${g3i._id}/decision`, { decision: 'approve' });
  const g3 = await loggedIn('gamma@gamma.test', 'coordinator', PW);
  const now = await g3.post('/api/institutions/mine/delete', { ...body, eraseNow: true });
  assert.equal(now.status, 200);
  assert.equal(now.body.data.erased, true);
  assert.equal(await Institution.countDocuments({ _id: g3i._id }), 0);
  // the platform owner can also erase a request for good
  assert.equal((await S.owner.post(`/api/institutions/${g3i._id}/decision`, { decision: 'purge' })).status, 404);
});

test('first-time platform setup: setup code needed (except on a brand-new local database)', async () => {
  (await import('../config/env.js')).default.coordinatorSetupCode = 'test-setup-code';
  // no platform owner, but users exist -> the secret code from server/.env is required
  await runUnscoped(() => User.updateMany({}, { $set: { isPlatformOwner: false } }));
  let o = await opts();
  assert.equal(o.platform.needsSetup, true);
  assert.equal(o.platform.needsSetupCode, true);
  const body = { name: 'First Owner', email: 'first@owner.test', password: PW, role: 'coordinator', institutionName: 'Owner Academy' };
  assert.equal((await anon().post('/api/auth/register', { ...body, setupCode: 'wrong' })).status, 403);
  const c = anon();
  const ok = await c.post('/api/auth/register', { ...body, setupCode: 'test-setup-code' });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.equal(ok.body.data.user.isPlatformOwner, true);
  assert.equal((await c.get('/api/institutions')).status, 200, 'logged in at once');
  // empty database in development: no code needed
  await runUnscoped(async () => { await User.deleteMany({}); await Institution.deleteMany({}); });
  o = await opts();
  assert.equal(o.platform.needsSetupCode, false);
  const c2 = anon();
  const r = await c2.post('/api/auth/register', { name: 'Local Dev', email: 'dev@local.test', password: PW, role: 'coordinator', institutionName: 'My College' });
  assert.equal(r.status, 201);
  assert.equal(r.body.data.user.isPlatformOwner, true);
  // migration is a no-op on a database that already has institutions
  const { migrateToInstitutions } = await import('../services/migration.js');
  await migrateToInstitutions({ log: () => {} });
  assert.equal(await Institution.countDocuments({}), 1);
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
  assert.equal(users.find((u) => u.email === 'oldc@old.test').isPlatformOwner, true, 'earliest coordinator becomes the platform owner');
  assert.ok(!users.find((u) => u.email === 'olds@old.test').isPlatformOwner);
  const dep = await mongoose.connection.collection('departments').findOne({ code: 'OLD' });
  assert.equal(String(dep.institution), String(inst[0]._id));
  // running it again changes nothing
  await migrateToInstitutions({ log: () => {} });
  assert.equal(await Institution.countDocuments({}), 1);
});
