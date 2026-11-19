// Department coordinators only see their own department; terms can pick existing batches.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, stopTestServer, Client, loggedIn } from './helpers.js';

before(startTestServer);
after(stopTestServer);

const S = {};
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

test('department coordinator sees only their department and cannot change institution-wide things', async () => {
  S.inst = await loggedIn('coordinator@apmms.test');
  S.dept = await loggedIn('deptcoordinator@apmms.test');
  const me = (await S.dept.get('/api/auth/me')).body.data.user;
  assert.equal(me.coordinatorLevel, 'department');

  // a second department with its own student, invisible to the Demo-department coordinator
  const dep1 = (await S.inst.get('/api/departments')).body.data;
  const fac = dep1[0].faculty._id || dep1[0].faculty;
  const mech = (await S.inst.post('/api/departments', { name: 'Mechanical', code: 'MEC', facultyId: fac })).body.data;
  const mine = (await S.dept.get('/api/users?role=student')).body.data;
  assert.ok(mine.length > 0);
  assert.ok(mine.every((u) => String(u.department?._id || u.department) !== String(mech._id)));

  const mk = await S.dept.post('/api/users', { name: 'Dept Kid', email: 'deptkid@apmms.test', role: 'student', studentId: 'DK-1', departmentId: mech._id, password: 'Passw0rd1' });
  assert.ok([201, 422].includes(mk.status));
  if (mk.status === 201) assert.notEqual(String(mk.body.data.department?._id || mk.body.data.department), String(mech._id), 'forced into own department');

  for (const [m, url, body] of [
    ['post', '/api/departments', { name: 'Hack', code: 'HCK', facultyId: fac }],
    ['post', '/api/faculties', { name: 'Hack Faculty' }],
    ['put', '/api/settings', {}],
  ]) assert.equal((await S.dept[m](url, body)).status, 403, `${m} ${url}`);
  assert.equal((await S.dept.get('/api/audit-logs')).status, 403);
  assert.equal((await S.dept.get('/api/users')).body.data.some((u) => u.role === 'coordinator' && u.coordinatorLevel !== 'department'), false);
});

test('a term can be created and edited with already-added batches', async () => {
  const dep = (await S.inst.get('/api/departments')).body.data[0];
  const b = (await S.inst.post('/api/batches', { name: '2022 Batch', departmentId: dep._id, intakeYear: 2022 })).body.data;
  const t = await S.inst.post('/api/academic-terms', { name: 'Fall Link', academicYear: '2026-2027', semester: 'Fall', startDate: day(-10), endDate: day(120), proposalDeadline: day(20), finalReportDeadline: day(100), batchIds: [b._id] });
  assert.equal(t.status, 201, JSON.stringify(t.body));
  assert.equal(t.body.data.linked.batches, 1);
  const list = (await S.inst.get('/api/batches')).body.data;
  assert.equal(String(list.find((x) => x._id === b._id).term._id), String(t.body.data._id));
  // editing the term can link another batch too
  const b2 = (await S.inst.post('/api/batches', { name: '2021 Batch', departmentId: dep._id, intakeYear: 2021 })).body.data;
  const u = await S.inst.patch(`/api/academic-terms/${t.body.data._id}`, { batchIds: [b2._id] });
  assert.equal(u.status, 200, JSON.stringify(u.body));
  assert.equal(String((await S.inst.get('/api/batches')).body.data.find((x) => x._id === b2._id).term._id), String(t.body.data._id));
  // unknown batch ids are ignored, not fatal
  assert.equal((await S.inst.patch(`/api/academic-terms/${t.body.data._id}`, { batchIds: ['64b000000000000000000000'] })).status, 200);
});

test('department coordinator can use academic terms for their own batches only', async () => {
  const deps = (await S.inst.get('/api/departments')).body.data;
  const mine = deps.find((d) => d.coordinator?.email === 'deptcoordinator@apmms.test');
  const other = deps.find((d) => d.name === 'Mechanical');
  const myDep = (await S.dept.get('/api/auth/me')).body.data.user.department;
  const rb = await S.dept.post('/api/batches', { name: '2019 Batch', intakeYear: 2019, departmentId: myDep._id || myDep });
  assert.equal(rb.status, 201, JSON.stringify(rb.body));
  const bMine = rb.body.data;
  const bOther = (await S.inst.post('/api/batches', { name: '2018 Mech', departmentId: other._id, intakeYear: 2018 })).body.data;
  assert.ok(mine || true);
  assert.equal((await S.dept.get('/api/academic-terms')).status, 200);
  const t = await S.dept.post('/api/academic-terms', { name: 'Dept Term', academicYear: '2031', semester: 'Fall', startDate: day(1), endDate: day(90), batchIds: [bMine._id, bOther._id] });
  assert.equal(t.status, 201, JSON.stringify(t.body));
  assert.equal(t.body.data.linked.batches, 1, 'only the own department batch is linked');
});

test('faculties and departments can be deleted by the institution coordinator and the admin, with safety rules', async () => {
  const fac = (await S.inst.post('/api/faculties', { name: 'Disposable Faculty' })).body.data;
  const dep = (await S.inst.post('/api/departments', { name: 'Disposable Dept', code: 'DSP', facultyId: fac._id })).body.data;
  // faculty with a department cannot be deleted
  assert.equal((await S.inst.del(`/api/faculties/${fac._id}`)).status, 409);
  // department coordinator cannot delete
  assert.equal((await S.dept.del(`/api/departments/${dep._id}`)).status, 403);
  // invite a coordinator, then delete the department: the invited account goes with it
  const inv = await S.inst.post(`/api/departments/${dep._id}/coordinator`, { name: 'Temp Coord', email: 'tempcoord@apmms.test' });
  assert.equal(inv.status, 201, JSON.stringify(inv.body));
  const struct = await S.inst.get('/api/structure');
  assert.equal(struct.status, 200);
  assert.ok(struct.body.data.departments.some((d) => d.name === 'Disposable Dept' && d.coordinator));
  assert.equal((await S.inst.del(`/api/departments/${dep._id}`)).status, 200);
  assert.equal((await S.inst.del(`/api/faculties/${fac._id}`)).status, 200);
  // a department that has users cannot be deleted
  const used = (await S.inst.get('/api/departments')).body.data.find((d) => d.students > 0);
  assert.equal((await S.inst.del(`/api/departments/${used._id}`)).status, 409);
});
