// Email verification, coordinator self-deletion and first-login guide flag.
// Uses the same wiped test database as the workflow tests (run one file at a time: see package.json).
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, stopTestServer, Client, loggedIn, latestToken, outbox } from './helpers.js';
import { User, Project } from '../models/index.js';

before(startTestServer);
after(stopTestServer);

const anon = () => new Client();
let depId;
let instId;
let batchId;
let facId;
const reg = (over = {}) => anon().post('/api/auth/register', { name: 'Vera Verify', email: 'vera@apmms.test', password: 'Passw0rd1', studentId: 'CSE-777', institutionId: instId, facultyId: facId, departmentId: depId, batchId, role: 'student', ...over });

test('registration sends a verification email and does NOT log the student in', async () => {
  const inst = (await anon().get('/api/auth/registration-options')).body.data.institutions[0];
  instId = inst._id;
  depId = inst.departments[0]._id;
  facId = inst.departments[0].faculty;
  batchId = inst.departments[0].batches[0]._id;
  const c = anon();
  const r = await c.post('/api/auth/register', { name: 'Vera Verify', email: 'vera@apmms.test', password: 'Passw0rd1', studentId: 'CSE-777', institutionId: instId, facultyId: facId, departmentId: depId, batchId, role: 'student' });
  assert.equal(r.status, 201);
  assert.equal(r.body.data.verificationRequired, true);
  assert.equal((await c.get('/api/auth/me')).status, 401, 'no session cookie yet');
  const mail = outbox.find((m) => m.to === 'vera@apmms.test');
  assert.ok(mail && /verify-email\?token=[a-f0-9]{64}/.test(mail.text), 'email contains the link');
  // only a hash is stored, never the raw token
  const row = await User.findOne({ email: 'vera@apmms.test' }).select('+emailVerification.tokenHash');
  assert.equal(row.emailVerified, false);
  assert.notEqual(row.emailVerification.tokenHash, latestToken('vera@apmms.test'));
  assert.equal(row.toJSON().emailVerification, undefined, 'hash never leaves the server');
});

test('login is blocked until verified, then works; the link works only once', async () => {
  const blocked = await anon().post('/api/auth/login', { email: 'vera@apmms.test', password: 'Passw0rd1', role: 'student' });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.code ?? blocked.body.error?.code ?? blocked.body.appCode, 'EMAIL_NOT_VERIFIED', JSON.stringify(blocked.body));
  const token = latestToken('vera@apmms.test');
  const v = await anon().post('/api/auth/verify-email', { token });
  assert.equal(v.status, 200);
  assert.equal(v.body.data.verified, true);
  assert.equal((await anon().post('/api/auth/login', { email: 'vera@apmms.test', password: 'Passw0rd1', role: 'student' })).status, 200);
  const again = await anon().post('/api/auth/verify-email', { token });
  assert.equal(again.status, 409);
  assert.match(again.body.message, /already used/);
});

test('invalid and expired links are handled; resend replaces the old link and is rate limited', async () => {
  assert.equal((await anon().post('/api/auth/verify-email', { token: 'f'.repeat(64) })).status, 400);
  await reg({ name: 'Eli Expire', email: 'eli@apmms.test', studentId: 'CSE-778' });
  const oldToken = latestToken('eli@apmms.test');
  // make the link expire
  await User.updateOne({ email: 'eli@apmms.test' }, { $set: { 'emailVerification.expiresAt': new Date(Date.now() - 1000) } });
  const exp = await anon().post('/api/auth/verify-email', { token: oldToken });
  assert.equal(exp.status, 410);
  assert.match(exp.body.message, /expired/);
  // resend: immediate second request hits the 60s cooldown (still the same generic answer, but no new email)
  const before1 = outbox.filter((m) => m.to === 'eli@apmms.test').length;
  assert.equal((await anon().post('/api/auth/resend-verification', { email: 'eli@apmms.test' })).status, 200);
  assert.equal(outbox.filter((m) => m.to === 'eli@apmms.test').length, before1, 'cooldown: no new email');
  await User.updateOne({ email: 'eli@apmms.test' }, { $set: { 'emailVerification.sentAt': new Date(Date.now() - 61000) } });
  assert.equal((await anon().post('/api/auth/resend-verification', { email: 'eli@apmms.test' })).status, 200);
  assert.equal(outbox.filter((m) => m.to === 'eli@apmms.test').length, before1 + 1);
  assert.equal((await anon().post('/api/auth/verify-email', { token: oldToken })).status, 400, 'the old link no longer works');
  assert.equal((await anon().post('/api/auth/verify-email', { token: latestToken('eli@apmms.test') })).status, 200);
  // hourly cap
  await reg({ name: 'Cap Cat', email: 'cap@apmms.test', studentId: 'CSE-779' });
  for (let i = 0; i < 8; i++) {
    await User.updateOne({ email: 'cap@apmms.test' }, { $set: { 'emailVerification.sentAt': new Date(Date.now() - 61000) } });
    await anon().post('/api/auth/resend-verification', { email: 'cap@apmms.test' });
  }
  assert.equal(outbox.filter((m) => m.to === 'cap@apmms.test').length, 5, 'at most 5 emails per hour');
  // unknown / already verified emails: same answer, no email
  const n = outbox.length;
  const unknown = await anon().post('/api/auth/resend-verification', { email: 'nobody@apmms.test' });
  const done = await anon().post('/api/auth/resend-verification', { email: 'vera@apmms.test' });
  assert.equal(unknown.status, 200);
  assert.equal(done.body.message, unknown.body.message);
  assert.equal(outbox.length, n);
});

test('existing and coordinator-created accounts need no verification; coordinator can mark one verified', async () => {
  assert.equal((await anon().post('/api/auth/login', { email: 'alice@apmms.test', password: 'Demo@12345', role: 'student' })).status, 200);
  const coord = await loggedIn('coordinator@apmms.test');
  const cap = await User.findOne({ email: 'cap@apmms.test' });
  assert.equal((await (await loggedIn('alice@apmms.test')).post(`/api/users/${cap._id}/mark-verified`, {})).status, 403);
  assert.equal((await coord.post(`/api/users/${cap._id}/mark-verified`, {})).status, 200);
  assert.equal((await anon().post('/api/auth/login', { email: 'cap@apmms.test', password: 'Passw0rd1', role: 'student' })).status, 200);
});

test('first-login guide flag is stored per account', async () => {
  const c = await loggedIn('alice@apmms.test');
  assert.equal((await c.get('/api/auth/me')).body.data.user.onboardingSeenAt, undefined);
  assert.equal((await c.post('/api/auth/onboarding-seen', {})).status, 200);
  assert.ok((await c.get('/api/auth/me')).body.data.user.onboardingSeenAt);
});

test('coordinator can soft-delete only their own account; records are kept', async () => {
  const coord = await loggedIn('coordinator@apmms.test');
  const me = (await coord.get('/api/auth/me')).body.data.user;
  const body = { password: 'Demo@12345', confirmText: 'DELETE' };
  assert.equal((await (await loggedIn('alice@apmms.test')).post('/api/auth/delete-account', body)).status, 403, 'students cannot');
  assert.equal((await coord.post('/api/auth/delete-account', { password: 'wrong-pass', confirmText: 'DELETE' })).status, 422);
  assert.equal((await coord.post('/api/auth/delete-account', { password: 'Demo@12345', confirmText: 'nope' })).status, 422);
  // the only coordinator is protected
  const last = await coord.post('/api/auth/delete-account', body);
  assert.equal(last.status, 409);
  // a second coordinator exists -> now allowed. Someone else's id in the body is ignored: only the logged-in account is touched.
  const other = new User({ name: 'Second Coordinator', email: 'coord2@apmms.test', role: 'coordinator', institution: me.institution._id });
  await other.setPassword('Passw0rd1');
  await other.save();
  const projectsBefore = await Project.countDocuments();
  const res = await coord.post('/api/auth/delete-account', { ...body, userId: String(other._id) });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const gone = await User.findById(me._id);
  assert.ok(gone.deletedAt && gone.isActive === false);
  assert.equal(gone.name, 'Dr. Carol Coordinator', 'name kept so history still reads correctly');
  assert.match(gone.email, /^deleted-.*@deleted\.invalid$/);
  const untouched = await User.findById(other._id);
  assert.equal(untouched.isActive, true);
  assert.equal(untouched.deletedAt, undefined);
  assert.equal(await Project.countDocuments(), projectsBefore, 'no project removed');
  // the old session cookie and the old password stop working
  assert.equal((await coord.get('/api/auth/me')).status, 401);
  assert.equal((await anon().post('/api/auth/login', { email: 'coordinator@apmms.test', password: 'Demo@12345', role: 'coordinator' })).status, 401);
  // a deleted account cannot be re-activated by another coordinator
  const c2 = await anon();
  await c2.post('/api/auth/login', { email: 'coord2@apmms.test', password: 'Passw0rd1', role: 'coordinator' });
  assert.equal((await c2.patch(`/api/users/${me._id}/status`, { isActive: true })).status, 409);
});

test('real SMTP delivery path works (local fake SMTP server, credentials come only from env)', async () => {
  const { SMTPServer } = await import('smtp-server');
  const env = (await import('../config/env.js')).default;
  const { sendMail } = await import('../services/mailer.js');
  const got = [];
  const srv = new SMTPServer({
    authOptional: false,
    disabledCommands: ['STARTTLS'],
    allowInsecureAuth: true,
    onAuth(auth, _s, cb) { got.push(`${auth.username}:${auth.password}`); cb(null, { user: 1 }); },
    onData(stream, _s, cb) { let d = ''; stream.on('data', (c) => (d += c)); stream.on('end', () => { got.push(d); cb(); }); },
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const saved = { ...env.smtp };
  Object.assign(env.smtp, { host: '127.0.0.1', port: srv.server.address().port, secure: false, user: 'mailer', pass: 'secret' });
  try {
    const r = await sendMail({ to: 'x@apmms.test', subject: 'Hello SMTP', text: 'link http://x/verify-email?token=abc' });
    assert.equal(r.sent, true);
    assert.equal(got[0], 'mailer:secret');
    assert.match(got[1], /Subject: Hello SMTP/);
    // failure never throws
    env.smtp.port = 1;
    const bad = await sendMail({ to: 'x@apmms.test', subject: 's', text: 't' }).catch(() => 'threw');
    assert.notEqual(bad, 'threw');
  } finally {
    Object.assign(env.smtp, saved);
    await new Promise((r) => srv.close(r));
  }
});
