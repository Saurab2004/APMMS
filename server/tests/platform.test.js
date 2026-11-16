// Platform Admin console: separate accounts/cookie/login, first-admin setup, admin management,
// institution + coordinator control, settings, audit log, health. Admins must never see student work.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, stopTestServer, Client, loggedIn, latestToken, adminLoggedIn, DEMO_PASSWORD } from './helpers.js';
import { PlatformAdmin, PlatformSetting, User, Institution } from '../models/index.js';
import env from '../config/env.js';

before(startTestServer);
after(stopTestServer);
const anon = () => new Client();
const PW = 'Passw0rd1';
const S = {};

test('first admin: setup page works once; production needs the secret setup code', async () => {
  await PlatformAdmin.deleteMany({});
  await PlatformSetting.deleteMany({ key: 'setupDone' });
  assert.deepEqual((await anon().get('/api/platform/setup-status')).body.data.needsSetup, true);
  const body = { name: 'Founder One', email: 'founder@site.test', password: PW };

  env.isProd = true;
  try {
    env.platformSetupCode = '';
    assert.equal((await anon().post('/api/platform/setup', body)).status, 403, 'production without a configured code');
    env.platformSetupCode = 'my-setup-code';
    assert.equal((await anon().post('/api/platform/setup', { ...body, setupCode: 'wrong' })).status, 403);
    assert.equal((await anon().post('/api/platform/setup', { ...body, password: 'short', setupCode: 'my-setup-code' })).status, 422);
    const c = anon();
    const r = await c.post('/api/platform/setup', { ...body, setupCode: 'my-setup-code' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.data.admin.isFounder, true);
    assert.equal(r.body.data.admin.passwordHash, undefined, 'no secrets in the response');
    assert.equal((await c.get('/api/platform/auth/me')).status, 200, 'logged in right after setup');
    // only once
    assert.equal((await anon().post('/api/platform/setup', { ...body, email: 'second@site.test', setupCode: 'my-setup-code' })).status, 409);
    assert.equal((await anon().get('/api/platform/setup-status')).body.data.needsSetup, false);
  } finally { env.isProd = false; env.platformSetupCode = ''; }
  S.founder = await adminLoggedIn('founder@site.test', PW);
});

test('admin login is separate from institution login, and brute force is slowed down', async () => {
  // wrong password / unknown email: same message
  const a = await anon().post('/api/platform/auth/login', { email: 'founder@site.test', password: 'Wrong-pass1' });
  const b = await anon().post('/api/platform/auth/login', { email: 'nobody@site.test', password: 'Wrong-pass1' });
  assert.equal(a.status, 401);
  assert.equal(a.body.message, b.body.message);
  // an institution account cannot use the admin login, and an admin cannot use the normal login
  assert.equal((await anon().post('/api/platform/auth/login', { email: 'coordinator@apmms.test', password: DEMO_PASSWORD })).status, 401);
  assert.equal((await anon().post('/api/auth/login', { email: 'founder@site.test', password: PW })).status, 401);
  // sessions do not cross over
  const coord = await loggedIn('coordinator@apmms.test');
  assert.equal((await coord.get('/api/platform/overview')).status, 401);
  assert.equal((await S.founder.get('/api/auth/me')).status, 401);
  assert.equal((await S.founder.get('/api/users')).status, 401);
  // 5 wrong passwords lock the account for a while (even the right password is refused)
  const c = anon();
  for (let i = 0; i < 5; i++) await c.post('/api/platform/auth/login', { email: 'founder@site.test', password: 'Wrong-pass1' });
  assert.equal((await c.post('/api/platform/auth/login', { email: 'founder@site.test', password: PW })).status, 429);
  await PlatformAdmin.updateOne({ email: 'founder@site.test' }, { $unset: { lockUntil: 1 }, $set: { failedLogins: 0 } });
  assert.equal((await c.post('/api/platform/auth/login', { email: 'founder@site.test', password: PW })).status, 200);
  // logout clears the session
  const out = await adminLoggedIn('founder@site.test', PW);
  await out.post('/api/platform/auth/logout');
  assert.equal((await out.get('/api/platform/auth/me')).status, 401);
});

test('adding admins: temporary password, forced change, deactivate / reactivate, protections', async () => {
  const dup = await S.founder.post('/api/platform/admins', { name: 'Dup', email: 'founder@site.test' });
  assert.equal(dup.status, 409);
  assert.equal((await S.founder.post('/api/platform/admins', { name: 'Dup', email: 'alice@apmms.test' })).status, 409, 'email of an institution account');
  const r = await S.founder.post('/api/platform/admins', { name: 'Second Admin', email: 'second@site.test' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const temp = r.body.data.tempPassword;
  assert.ok(temp && temp.length >= 10);
  const second = anon();
  assert.equal((await second.post('/api/platform/auth/login', { email: 'second@site.test', password: temp })).status, 200);
  const blocked = await second.get('/api/platform/overview');
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.code, 'PASSWORD_CHANGE_REQUIRED');
  assert.equal((await second.post('/api/platform/auth/change-password', { currentPassword: temp, newPassword: temp })).status, 422, 'must be different');
  assert.equal((await second.post('/api/platform/auth/change-password', { currentPassword: temp, newPassword: 'NewPassw0rd9' })).status, 200);
  assert.equal((await second.get('/api/platform/overview')).status, 200, 'works after the change, same browser stays logged in');

  // a normal sign-up cannot reuse an admin's email (the forgot-password link would be ambiguous)
  const reg = await anon().post('/api/auth/register', { name: 'Sneaky', email: 'second@site.test', password: PW, role: 'student', studentId: 'X-1', institutionId: (await Institution.findOne({ nameKey: 'demo university' }))._id, departmentId: (await (await import('../models/index.js')).Department.findOne({}))._id, batchId: (await (await import('../models/index.js')).Batch.findOne({}))._id });
  assert.equal(reg.status, 409);

  const list = (await S.founder.get('/api/platform/admins')).body.data;
  const sec = list.find((a) => a.email === 'second@site.test');
  const fnd = list.find((a) => a.email === 'founder@site.test');
  assert.equal(sec.passwordHash, undefined);
  // protections
  assert.equal((await S.founder.post(`/api/platform/admins/${fnd._id}/action`, { action: 'deactivate' })).status, 409, 'cannot switch yourself off');
  assert.equal((await second.post(`/api/platform/admins/${fnd._id}/action`, { action: 'deactivate' })).status, 409, 'the founder is protected');
  assert.equal((await second.post(`/api/platform/admins/${fnd._id}/action`, { action: 'reset-password' })).status, 409);
  // deactivate: logged out at once and cannot log in
  assert.equal((await S.founder.post(`/api/platform/admins/${sec._id}/action`, { action: 'deactivate' })).status, 200);
  assert.equal((await second.get('/api/platform/overview')).status, 401);
  assert.equal((await anon().post('/api/platform/auth/login', { email: 'second@site.test', password: 'NewPassw0rd9' })).status, 403);
  assert.equal((await S.founder.post(`/api/platform/admins/${sec._id}/action`, { action: 'reactivate' })).status, 200);
  // reset password by another admin: new temporary password, old one dead
  const rp = await S.founder.post(`/api/platform/admins/${sec._id}/action`, { action: 'reset-password' });
  assert.equal(rp.status, 200);
  assert.equal((await anon().post('/api/platform/auth/login', { email: 'second@site.test', password: 'NewPassw0rd9' })).status, 401);
  assert.equal((await anon().post('/api/platform/auth/login', { email: 'second@site.test', password: rp.body.data.tempPassword })).status, 200);
});

test('overview and institution list show counts, never student work', async () => {
  const ov = (await S.founder.get('/api/platform/overview')).body.data;
  assert.ok(ov.institutions.total >= 1);
  assert.ok(ov.totals.students >= 3);
  const list = (await S.founder.get('/api/platform/institutions')).body.data;
  const demo = list.find((i) => i.name === 'Demo University');
  assert.ok(demo.counts.students >= 3 && demo.counts.supervisors >= 2 && demo.counts.coordinators >= 1);
  assert.equal(demo.coordinators[0].email, 'coordinator@apmms.test');
  const detail = await S.founder.get(`/api/platform/institutions/${demo._id}`);
  assert.equal(detail.status, 200);
  const text = JSON.stringify([ov, list, detail.body]);
  assert.ok(!text.includes('alice@apmms.test') && !text.includes('Alice Student'), 'no student accounts or work are exposed');
  assert.equal((await S.founder.get('/api/platform/institutions?q=demo')).body.data.length, 1);
  assert.equal((await S.founder.get('/api/platform/institutions?q=zzz')).body.data.length, 0);
  const csv = await S.founder.raw('GET', '/api/platform/institutions/export.csv');
  assert.match(csv.headers.get('content-type'), /text\/csv/);
  assert.match(await csv.text(), /Demo University/);
  assert.equal((await S.founder.get('/api/platform/institutions/not-an-id')).status, 404);
});

test('admin creates an institution + coordinator; coordinator help actions', async () => {
  const bad = await S.founder.post('/api/platform/institutions', { institutionName: 'Demo University', coordinatorName: 'X Y', coordinatorEmail: 'x@y.test' });
  assert.equal(bad.status, 409);
  const r = await S.founder.post('/api/platform/institutions', { institutionName: 'Delta Academy', institutionType: 'school', coordinatorName: 'Dee Delta', coordinatorEmail: 'dee@delta.test' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  S.delta = r.body.data.institution._id;
  assert.equal(r.body.data.institution.status, 'approved');
  const dee = anon();
  const login = await dee.post('/api/auth/login', { email: 'dee@delta.test', password: r.body.data.tempPassword, role: 'coordinator' });
  assert.equal(login.status, 200, JSON.stringify(login.body));
  assert.equal(login.body.data.user.mustChangePassword, true);
  assert.equal((await dee.get('/api/platform/overview')).status, 401, 'a coordinator the admin created is still only a coordinator');
  const coordId = r.body.data.coordinator._id;

  // reset password: sessions die, new temp password works
  const rp = await S.founder.post(`/api/platform/coordinators/${coordId}/action`, { action: 'reset-password' });
  assert.equal(rp.status, 200);
  assert.equal((await dee.get('/api/auth/me')).status, 401, 'old session ended');
  assert.equal((await anon().post('/api/auth/login', { email: 'dee@delta.test', password: rp.body.data.tempPassword, role: 'coordinator' })).status, 200);
  // deactivate / reactivate
  const dee2 = await loggedIn('dee@delta.test', 'coordinator', rp.body.data.tempPassword);
  assert.equal((await S.founder.post(`/api/platform/coordinators/${coordId}/action`, { action: 'deactivate' })).status, 200);
  assert.equal((await dee2.get('/api/auth/me')).status, 401);
  assert.equal((await anon().post('/api/auth/login', { email: 'dee@delta.test', password: rp.body.data.tempPassword, role: 'coordinator' })).status, 403);
  assert.equal((await S.founder.post(`/api/platform/coordinators/${coordId}/action`, { action: 'reactivate' })).status, 200);
  assert.equal((await anon().post('/api/auth/login', { email: 'dee@delta.test', password: rp.body.data.tempPassword, role: 'coordinator' })).status, 200);
  // only coordinators can be targeted
  const alice = await User.findOne({ email: 'alice@apmms.test' });
  assert.equal((await S.founder.post(`/api/platform/coordinators/${alice._id}/action`, { action: 'deactivate' })).status, 404);
  assert.equal((await S.founder.post(`/api/platform/coordinators/${coordId}/action`, { action: 'explode' })).status, 422);

  // a coordinator who never verified: resend, or the admin vouches for the email (this activates the institution)
  const reg = await anon().post('/api/auth/register', { name: 'Eve Epsilon', email: 'eve@eps.test', password: PW, role: 'coordinator', institutionName: 'Epsilon College' });
  assert.equal(reg.status, 201);
  const un = (await S.founder.get('/api/platform/coordinators?state=unverified')).body.data;
  const eve = un.find((c) => c.email === 'eve@eps.test');
  assert.ok(eve);
  assert.equal(eve.institution.name, 'Epsilon College');
  assert.equal((await S.founder.post(`/api/platform/coordinators/${eve._id}/action`, { action: 'resend-verification' })).status, 200);
  const v = await S.founder.post(`/api/platform/coordinators/${eve._id}/action`, { action: 'verify-email' });
  assert.equal(v.status, 200);
  assert.equal(v.body.data.activated, true);
  assert.equal((await anon().post('/api/auth/login', { email: 'eve@eps.test', password: PW, role: 'coordinator' })).status, 200);
  assert.equal((await S.founder.get('/api/platform/coordinators?q=eve')).body.data.length, 1);
});

test('admin can rename an institution, suspend it (people blocked) and restore it', async () => {
  assert.equal((await S.founder.patch(`/api/platform/institutions/${S.delta}`, { name: 'Demo University' })).status, 409);
  assert.equal((await S.founder.patch(`/api/platform/institutions/${S.delta}`, { name: 'Delta Public School', type: 'school' })).status, 200);
  const dee = await loggedIn('dee@delta.test', 'coordinator', (await resetFor('dee@delta.test')));
  assert.equal((await S.founder.post(`/api/platform/institutions/${S.delta}/decision`, { decision: 'suspend', note: 'Unpaid' })).status, 200);
  assert.equal((await dee.get('/api/auth/me')).status, 403);
  assert.equal((await S.founder.post(`/api/platform/institutions/${S.delta}/decision`, { decision: 'reactivate' })).status, 200);
  assert.equal((await dee.get('/api/auth/me')).status, 200);
});
async function resetFor(email) {
  const u = await User.findOne({ email });
  const c = (await import('../models/index.js'));
  const pw = 'Reset-Pass-77';
  await u.setPassword(pw);
  u.mustChangePassword = false;
  await u.save();
  void c;
  return pw;
}

test('platform settings: switch off new institution sign-up, login notice', async () => {
  assert.equal((await S.founder.get('/api/platform/settings')).body.data.allowInstitutionRegistration, true);
  const put = await S.founder.put('/api/platform/settings', { allowInstitutionRegistration: false, loginNotice: 'Maintenance on Sunday' });
  assert.equal(put.status, 200);
  const o = (await anon().get('/api/auth/registration-options')).body.data;
  assert.equal(o.platform.allowInstitutionRegistration, false);
  assert.equal(o.platform.notice, 'Maintenance on Sunday');
  const r = await anon().post('/api/auth/register', { name: 'Late Comer', email: 'late@x.test', password: PW, role: 'coordinator', institutionName: 'Late College' });
  assert.equal(r.status, 403);
  // students and supervisors can still join existing institutions
  const demo = o.institutions.find((i) => i.name === 'Demo University');
  assert.equal((await anon().post('/api/auth/register', { name: 'Still Ok', email: 'stillok@x.test', password: PW, role: 'student', studentId: 'OK-1', institutionId: demo._id, departmentId: demo.departments[0]._id, batchId: demo.departments[0].batches[0]?._id })).status, 201);
  await S.founder.put('/api/platform/settings', { allowInstitutionRegistration: true, loginNotice: '' });
  assert.equal((await anon().get('/api/auth/registration-options')).body.data.platform.allowInstitutionRegistration, true);
});

test('platform audit log records admin actions; health has no secrets', async () => {
  const log = (await S.founder.get('/api/platform/audit?limit=100')).body;
  const actions = log.data.map((a) => a.action);
  for (const a of ['admin.setup', 'admin.created', 'institution.created', 'institution.suspend', 'coordinator.reset-password', 'platform.settings_changed']) assert.ok(actions.includes(a), `${a} is logged`);
  assert.ok(log.data[0].actorName);
  assert.ok((await S.founder.get('/api/platform/audit?action=institution')).body.data.every((a) => a.action.startsWith('institution')));
  const h = (await S.founder.get('/api/platform/health')).body.data;
  assert.equal(h.status, 'ok');
  assert.equal(h.database.state, 'connected');
  assert.equal(typeof h.uploads.bytes, 'number');
  const text = JSON.stringify(h);
  assert.ok(!text.includes(env.jwtSecret) && !/mongodb(\+srv)?:\/\//.test(text), 'no secrets or connection strings');
  assert.equal((await anon().get('/api/platform/audit')).status, 401);
  assert.equal((await anon().get('/api/platform/health')).status, 401);
});

test('admin forgot-password: link by email, old sessions end, works on the shared reset page', async () => {
  const c = await adminLoggedIn('founder@site.test', PW);
  assert.equal((await anon().post('/api/auth/forgot-password', { email: 'nobody-here@site.test' })).status, 200, 'same answer for unknown emails');
  assert.equal((await anon().post('/api/auth/forgot-password', { email: 'founder@site.test' })).status, 200);
  const token = latestToken('founder@site.test');
  assert.equal((await anon().post('/api/auth/reset-password', { token, password: 'Fresh-Pass-55' })).status, 200);
  assert.equal((await c.get('/api/platform/auth/me')).status, 401, 'old session ended');
  assert.equal((await anon().post('/api/auth/reset-password', { token, password: 'Another-Pass-55' })).status, 400, 'link works once');
  assert.equal((await anon().post('/api/platform/auth/login', { email: 'founder@site.test', password: 'Fresh-Pass-55' })).status, 200);
});
