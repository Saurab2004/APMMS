// Batches: one department has many batches; each batch works in its own term; groups follow the student's batch.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, stopTestServer, Client, loggedIn } from './helpers.js';
import { User, Department, Institution, Batch, AcademicTerm } from '../models/index.js';
import { runUnscoped } from '../utils/tenant.js';

before(startTestServer);
after(stopTestServer);

const S = {};
const PW = 'Passw0rd1';
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

test('setup: a second term and a second batch in the same department', async () => {
  S.coord = await loggedIn('coordinator@apmms.test');
  S.sup = await loggedIn('supervisor@apmms.test');
  S.alice = await loggedIn('alice@apmms.test');
  S.bob = await loggedIn('bob@apmms.test');
  S.chitra = await loggedIn('chitra@apmms.test');
  S.dep = (await S.coord.get('/api/departments')).body.data[0];
  S.term1 = (await S.coord.get('/api/academic-terms')).body.data[0];
  const t2 = await S.coord.post('/api/academic-terms', { name: 'Spring Older', academicYear: '2025-2026', semester: 'Spring', startDate: day(-200), endDate: day(200), proposalDeadline: day(5), finalReportDeadline: day(50) });
  assert.equal(t2.status, 201);
  S.term2 = t2.body.data;
  // two terms can be active at the same time (the old "only one" rule only decides the default term)
  assert.equal((await S.coord.get('/api/academic-terms')).body.data.filter((t) => t.isActive).length, 2);

  const list = (await S.coord.get('/api/batches')).body.data;
  S.batchA = list[0]; // seeded batch, linked to term1
  assert.equal(String(S.batchA.term._id), String(S.term1._id));
  assert.equal(S.batchA.students, 3);

  const b = await S.coord.post('/api/batches', { name: '2023 Batch', departmentId: S.dep._id, intakeYear: 2023, termId: S.term2._id });
  assert.equal(b.status, 201);
  S.batchB = b.body.data;
  assert.equal((await S.coord.post('/api/batches', { name: '2023 Batch', departmentId: S.dep._id })).status, 409, 'same name twice in one department');
  assert.equal((await S.coord.post('/api/batches', { name: 'X', departmentId: S.dep._id })).status, 422, 'name too short');
  assert.equal((await S.alice.post('/api/batches', { name: 'Hack Batch', departmentId: S.dep._id })).status, 403, 'students cannot create batches');
  assert.equal((await S.sup.get('/api/batches')).status, 200, 'supervisors can list batches for filters');
});

test('registration shows the batches of the chosen department and requires one', async () => {
  const anon = () => new Client();
  const inst = (await anon().get('/api/auth/registration-options')).body.data.institutions[0];
  const dep = inst.departments[0];
  assert.equal(dep.batches.length, 2);
  const base = { name: 'New Kid', email: 'kid@apmms.test', password: PW, role: 'student', studentId: 'CSE-500', institutionId: inst._id, departmentId: dep._id };
  assert.equal((await anon().post('/api/auth/register', base)).status, 422, 'batch is required when the department has open batches');
  assert.equal((await anon().post('/api/auth/register', { ...base, batchId: '64b000000000000000000000' })).status, 422, 'unknown batch');

  // a batch of another department is refused
  const civil = (await S.coord.post('/api/departments', { name: 'Civil Engineering', code: 'CIV' })).body.data;
  const other = (await S.coord.post('/api/batches', { name: '2024 Batch', departmentId: civil._id, intakeYear: 2024, termId: S.term1._id })).body.data;
  assert.equal((await anon().post('/api/auth/register', { ...base, batchId: other._id })).status, 422, 'batch must belong to the chosen department');

  const ok = await anon().post('/api/auth/register', { ...base, batchId: S.batchB._id });
  assert.equal(ok.status, 201);
  const kid = await runUnscoped(() => User.findOne({ email: 'kid@apmms.test' }).lean());
  assert.equal(String(kid.batch), String(S.batchB._id));
  assert.equal(String(kid.term), String(S.term2._id), 'the student follows the batch term');
});

test('two batches in two terms at once: groups and deadlines follow each batch; one supervisor works with both', async () => {
  // bob moves to the older batch (the coordinator may correct a student's batch)
  const bobUser = (await S.coord.get('/api/users?q=bob')).body.data[0];
  const chg = await S.coord.patch(`/api/users/${bobUser._id}`, { batchId: S.batchB._id });
  assert.equal(chg.status, 200);

  const ga = await S.alice.post('/api/groups', { name: 'Alpha Team' });
  const gb = await S.bob.post('/api/groups', { name: 'Beta Team' });
  assert.equal(ga.status, 201);
  assert.equal(gb.status, 201);
  assert.equal(String(ga.body.data.group.term._id), String(S.term1._id));
  assert.equal(String(gb.body.data.group.term._id), String(S.term2._id));
  assert.equal(gb.body.data.group.batch.name, '2023 Batch');
  S.gA = ga.body.data;
  S.gB = gb.body.data;

  // each project reports the deadlines of its own term
  const pa = (await S.coord.get(`/api/projects/${S.gA.project._id}`)).body.data;
  const pb = (await S.coord.get(`/api/projects/${S.gB.project._id}`)).body.data;
  const dl = (p) => (p.project || p).term.deadlines.proposal;
  assert.notEqual(String(dl(pa)), String(dl(pb)), 'different batches, different deadlines');

  // filters
  assert.equal((await S.coord.get(`/api/projects?batch=${S.batchA._id}`)).body.data.length, 1);
  assert.equal((await S.coord.get(`/api/projects?batch=${S.batchB._id}`)).body.data.length, 1);
  assert.equal((await S.coord.get(`/api/groups?batch=${S.batchB._id}`)).body.data.length, 1);

  // one supervisor takes both
  const sup = (await S.coord.get('/api/users/supervisors')).body.data.find((u) => u.email === 'supervisor@apmms.test');
  for (const g of [S.gA, S.gB]) assert.equal((await S.coord.put(`/api/projects/${g.project._id}/supervisor`, { supervisorId: sup._id })).status, 200);
  assert.equal((await S.sup.get('/api/projects')).body.data.length, 2, 'the supervisor sees both batches');
  assert.equal((await S.sup.get(`/api/projects?batch=${S.batchB._id}`)).body.data.length, 1, 'and can filter by batch');
  const wl = (await S.coord.get('/api/batches/workload')).body.data.find((s) => s.email === 'supervisor@apmms.test');
  assert.equal(wl.total, 2);
  assert.equal(wl.perBatch.length, 2);

  // the calendar shows the deadlines of both terms
  const cal = (await S.sup.get(`/api/calendar?from=${day(-10)}&to=${day(70)}`)).body.data.filter((e) => e.type === 'deadline');
  assert.ok(cal.length >= 2);
});

test('batches stay separate: no joining, inviting or batch switching across them', async () => {
  const code = S.gB.group.code;
  assert.equal((await S.chitra.post('/api/groups/join', { code })).status, 403, 'a 2024-style batch student cannot join the other batch group');
  assert.equal((await S.alice.post(`/api/groups/${S.gA.group._id}/invite`, { email: 'bob@apmms.test' })).status, 409, 'cannot invite a student of another batch');
  const bobUser = (await S.coord.get('/api/users?q=bob')).body.data[0];
  assert.equal((await S.coord.patch(`/api/users/${bobUser._id}`, { batchId: S.batchA._id })).status, 409, 'cannot switch batch while in an active group');
});

test('moving a batch to the next term moves its students and unfinished groups', async () => {
  const mv = await S.coord.post(`/api/batches/${S.batchB._id}/move-term`, { termId: S.term1._id });
  assert.equal(mv.status, 200);
  assert.equal(mv.body.data.movedGroups, 1);
  const pb = (await S.coord.get(`/api/projects/${S.gB.project._id}`)).body.data;
  assert.equal(String((pb.project || pb).term._id), String(S.term1._id));
  const bobUser = (await S.coord.get('/api/users?q=bob')).body.data[0];
  assert.equal(String((await S.coord.get(`/api/users/${bobUser._id}`)).body.data.user.term._id), String(S.term1._id));
  assert.equal((await S.coord.post(`/api/batches/${S.batchB._id}/move-term`, { termId: '64b000000000000000000000' })).status, 422);
});

test('a completed batch is closed: no new groups, hidden from sign-up and everyday lists', async () => {
  const done = await S.coord.patch(`/api/batches/${S.batchB._id}`, { status: 'completed' });
  assert.equal(done.status, 200);
  assert.equal(done.body.data.allowSignup, false);
  const inst = (await new Client().get('/api/auth/registration-options')).body.data.institutions[0];
  assert.equal(inst.departments.find((d) => d._id === S.dep._id).batches.length, 1, 'only the active batch is offered at sign-up');
  assert.ok(!(await S.coord.get(`/api/batches?department=${S.dep._id}`)).body.data.some((b) => b._id === S.batchB._id), 'hidden by default');
  assert.ok((await S.coord.get('/api/batches?all=1')).body.data.some((b) => b._id === S.batchB._id), 'the coordinator can still list it');
  assert.equal((await S.coord.post(`/api/batches/${S.batchB._id}/move-term`, { termId: S.term2._id })).status, 409);

  // a student of a completed batch cannot start a group
  const chitraUser = (await S.coord.get('/api/users?q=chitra')).body.data[0];
  assert.equal((await S.coord.patch(`/api/users/${chitraUser._id}`, { batchId: S.batchB._id })).status, 200);
  const r = await S.chitra.post('/api/groups', { name: 'Gamma Team' });
  assert.equal(r.status, 409);
  assert.match(r.body.message, /completed/);
});

test('a student without a batch uses the default term; with no default the message says what to do', async () => {
  const chitraUser = (await S.coord.get('/api/users?q=chitra')).body.data[0];
  await runUnscoped(() => User.updateOne({ _id: chitraUser._id }, { $unset: { batch: '' } })); // an older account without a batch
  const fb = await S.chitra.post('/api/groups', { name: 'Gamma Team' });
  assert.equal(fb.status, 201, JSON.stringify(fb.body));
  await runUnscoped(() => AcademicTerm.updateMany({}, { $set: { isCurrent: false } }));
  const dana = await runUnscoped(async () => {
    const dep = await Department.findOne({ code: 'CSE' });
    const u = new User({ name: 'Dana', email: 'dana@apmms.test', role: 'student', studentId: 'CSE-600', department: dep._id, institution: dep.institution });
    await u.setPassword('Demo@12345');
    return u.save();
  });
  const c = await loggedIn(dana.email);
  const r = await c.post('/api/groups', { name: 'Delta Team' });
  assert.equal(r.status, 409);
  assert.match(r.body.message, /assign your batch/);
});

test('migration gives students and groups from before batches a starting batch "Existing students"', async () => {
  const { migrateToInstitutions } = await import('../services/migration.js');
  const inst = await Institution.findOne({});
  const result = await runUnscoped(async () => {
    const dep = await Department.create({ institution: inst._id, name: 'Legacy Dept', code: 'LEG' });
    const term = await AcademicTerm.findOne({});
    await User.collection.insertOne({ name: 'Old Stu', email: 'oldstu@apmms.test', role: 'student', studentId: 'L-1', department: dep._id, term: term._id, institution: inst._id, isActive: true, approvalStatus: 'approved', passwordHash: 'x' });
    return dep;
  });
  await migrateToInstitutions({ log: () => {} });
  const b = await runUnscoped(() => Batch.findOne({ department: result._id }).lean());
  assert.equal(b.name, 'Existing students');
  assert.equal(b.allowSignup, false);
  const u = await runUnscoped(() => User.findOne({ email: 'oldstu@apmms.test' }).lean());
  assert.equal(String(u.batch), String(b._id));
  await migrateToInstitutions({ log: () => {} });
  assert.equal(await runUnscoped(() => Batch.countDocuments({ department: result._id })), 1, 'running it again changes nothing');
});
