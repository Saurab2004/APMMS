// End-to-end API test of the whole academic workflow against a real MongoDB.
// It uses its own database (apmms_test) which is wiped before and after the run.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, stopTestServer, Client, loggedIn, form, pdfBlob, base, verifyFromOutbox } from './helpers.js';

const S = {}; // shared state between the ordered steps
before(startTestServer);
after(stopTestServer);

const proposalBody = {
  title: 'Smart Campus Navigation',
  abstract: 'A mobile friendly web platform that helps new students find rooms, labs and offices on campus.',
  problemStatement: 'New students lose time finding rooms because campus maps are outdated and scattered.',
  objectives: 'Build an indoor map, a search feature and an accessibility route planner.',
  methodology: 'Agile sprints, user interviews, prototype testing and iterative delivery.',
  expectedOutcomes: 'A working navigation web app.',
  technologyStack: ['React', 'Node.js', 'MongoDB'],
};

test('security basics: auth required, CSRF header required, RBAC enforced', async () => {
  const anon = new Client();
  assert.equal((await anon.get('/api/auth/me')).status, 401);
  assert.equal((await anon.call('POST', '/api/auth/login', { email: 'alice@apmms.test', password: 'Demo@12345' }, { csrf: false })).status, 403);
  assert.equal((await anon.post('/api/auth/login', { email: 'alice@apmms.test', password: 'wrong' })).status, 401);
  const health = await fetch(`${base}/api/health`);
  assert.equal((await health.json()).data.database, 'connected');

  const alice = await loggedIn('alice@apmms.test');
  assert.equal((await alice.get('/api/users')).status, 403);
  assert.equal((await alice.get('/api/audit-logs')).status, 403);
  const me = await alice.get('/api/auth/me');
  assert.equal(me.body.data.user.passwordHash, undefined);
  // Public registration: a student is active at once; nobody can sneak in as coordinator
  const reg = await anon.get('/api/auth/registration-options');
  const inst = reg.body.data.institutions[0];
  const depId = inst.departments[0]._id;
  const r = await new Client().post('/api/auth/register', { name: 'Eve New', email: 'eve@apmms.test', password: 'Passw0rd1', studentId: 'CSE-099', institutionId: inst._id, departmentId: depId, role: 'student' });
  assert.equal(r.status, 201);
  assert.equal(r.body.data.verificationRequired, true, 'students must verify their email first (no automatic login)');
  assert.equal(r.body.data.user, undefined);
  // a coordinator sign-up never gives instant access: it creates a PENDING institution
  const sneaky = await new Client().post('/api/auth/register', { name: 'Eve Boss', email: 'eve2@apmms.test', password: 'Passw0rd1', role: 'coordinator', institutionName: 'Eve Academy' });
  assert.equal(sneaky.status, 201);
  assert.equal(sneaky.body.data.pending, true);
  assert.equal(sneaky.body.data.user, undefined);
});

test('groups: create, invite, join by code, duplicate membership blocked', async () => {
  S.alice = await loggedIn('alice@apmms.test');
  S.bob = await loggedIn('bob@apmms.test');
  S.chitra = await loggedIn('chitra@apmms.test');
  const g = await S.alice.post('/api/groups', { name: 'Team Alpha' });
  assert.equal(g.status, 201, JSON.stringify(g.body));
  const mine = await S.alice.get('/api/groups/mine');
  assert.equal(mine.body.data.current.myRole, 'leader');
  S.group = mine.body.data.current.group;
  S.projectId = mine.body.data.current.project?._id;
  assert.equal((await S.alice.post('/api/groups', { name: 'Team Beta' })).status, 409); // already in an active group

  const join = await S.bob.post('/api/groups/join', { code: S.group.code });
  assert.equal(join.status, 200, JSON.stringify(join.body));
  assert.equal((await S.bob.post('/api/groups/join', { code: S.group.code })).status, 409); // duplicate

  const inv = await S.alice.post(`/api/groups/${S.group._id}/invite`, { email: 'chitra@apmms.test' });
  assert.equal(inv.status, 201, JSON.stringify(inv.body));
  const chitraGroups = await S.chitra.get('/api/groups/mine');
  assert.equal(chitraGroups.body.data.incomingInvitations.length, 1);
  // Bob (member) may not invite
  assert.equal((await S.bob.post(`/api/groups/${S.group._id}/invite`, { email: 'eve@apmms.test' })).status, 403);
  // Chitra rejects, so she stays outside the group (she is used as an "outsider" below)
  const rej = await S.chitra.post(`/api/groups/invitations/${chitraGroups.body.data.incomingInvitations[0]._id}/respond`, { accept: false });
  assert.equal(rej.status, 200);

  if (!S.projectId) {
    const p = await S.alice.get('/api/projects/mine');
    S.projectId = p.body.data.projectId;
  }
  assert.ok(S.projectId);
});

test('coordinator assigns supervisor; audit log records it', async () => {
  S.coord = await loggedIn('coordinator@apmms.test');
  S.sup = await loggedIn('supervisor@apmms.test');
  S.sup2 = await loggedIn('supervisor2@apmms.test');
  const sups = await S.coord.get('/api/users/supervisors');
  const sup = sups.body.data.find((u) => u.email === 'supervisor@apmms.test');
  const a = await S.coord.put(`/api/projects/${S.projectId}/supervisor`, { supervisorId: sup._id });
  assert.equal(a.status, 200, JSON.stringify(a.body));
  const logs = await S.coord.get('/api/audit-logs');
  assert.ok(logs.body.data.length > 0);
  // Supervisor sees the project, the other supervisor and the outsider do not
  assert.equal((await S.sup.get(`/api/projects/${S.projectId}`)).status, 200);
  assert.equal((await S.sup2.get(`/api/projects/${S.projectId}`)).status, 404);
  assert.equal((await S.chitra.get(`/api/projects/${S.projectId}`)).status, 404);
});

test('proposal: leader-only submit, revision, resubmission, approval keeps history', async () => {
  const url = `/api/proposals/project/${S.projectId}`;
  assert.equal((await S.bob.put(`${url}/draft`, proposalBody)).status, 403); // member cannot edit official proposal
  assert.equal((await S.alice.put(`${url}/draft`, proposalBody)).status, 200);
  assert.equal((await S.bob.post(`${url}/submit`)).status, 403);
  const sub = await S.alice.post(`${url}/submit`);
  assert.equal(sub.status, 200, JSON.stringify(sub.body));
  S.proposalId = sub.body.data.proposal._id;

  // supervisor must explain a revision request
  assert.equal((await S.sup.post(`/api/proposals/${S.proposalId}/review`, { decision: 'revision_required' })).status, 422);
  assert.equal((await S.sup.post(`/api/proposals/${S.proposalId}/review`, { decision: 'revision_required', comments: 'Narrow the scope.' })).status, 200);
  assert.equal((await S.sup2.post(`/api/proposals/${S.proposalId}/review`, { decision: 'approved' })).status, 404); // not assigned

  assert.equal((await S.alice.put(`${url}/draft`, { ...proposalBody, objectives: 'Build an indoor map and a search feature only.' })).status, 200);
  assert.equal((await S.alice.post(`${url}/submit`)).status, 200);
  assert.equal((await S.sup.post(`/api/proposals/${S.proposalId}/review`, { decision: 'approved' })).status, 200);

  const full = await S.alice.get(url);
  assert.equal(full.body.data.proposal.status, 'approved');
  assert.equal(full.body.data.versions.length, 2, 'both versions are preserved');
  const n = await S.alice.get('/api/notifications/unread-count');
  assert.ok(n.body.data.unread > 0, 'leader was notified');
});

test('progress report: upload, access control, revision, resubmission, approval, secure download', async () => {
  const mk = (extra = {}) => form({ project: S.projectId, title: 'Week 1 report', type: 'weekly', description: 'Did things', ...extra }, { file: { blob: pdfBlob('v1'), name: 'week1.pdf' } });
  assert.equal((await S.bob.call('POST', '/api/reports', mk())).status, 403); // member cannot submit
  // wrong file content
  const fake = form({ project: S.projectId, title: 'Bad file' }, { file: { blob: new Blob(['MZ not pdf'], { type: 'application/pdf' }), name: 'x.pdf' } });
  assert.equal((await S.alice.call('POST', '/api/reports', fake)).status, 415);
  const exe = form({ project: S.projectId, title: 'Bad ext' }, { file: { blob: pdfBlob(), name: 'x.exe' } });
  assert.equal((await S.alice.call('POST', '/api/reports', exe)).status, 415);

  const created = await S.alice.call('POST', '/api/reports', mk());
  assert.equal(created.status, 201, JSON.stringify(created.body));
  S.reportId = created.body.data.report?._id || created.body.data._id;
  assert.ok(S.reportId);

  const queue = await S.sup.get('/api/reports?needsReview=1');
  assert.equal(queue.body.data.length, 1);
  assert.equal((await S.sup2.get('/api/reports?needsReview=1')).body.data.length, 0);
  assert.equal((await S.chitra.get(`/api/reports/${S.reportId}`)).status, 404);

  const dl = await S.sup.raw('GET', `/api/reports/${S.reportId}/versions/1/file`);
  assert.equal(dl.status, 200);
  assert.equal(dl.headers.get('content-type'), 'application/pdf');
  assert.match(await dl.text(), /^%PDF-/);
  assert.equal((await S.sup2.raw('GET', `/api/reports/${S.reportId}/versions/1/file`)).status, 404);
  assert.equal((await new Client().raw('GET', `/api/reports/${S.reportId}/versions/1/file`)).status, 401);

  assert.equal((await S.sup.post(`/api/reports/${S.reportId}/review`, { decision: 'revision_required', comments: 'Add test results.' })).status, 200);
  const re = await S.alice.call('POST', `/api/reports/${S.reportId}/resubmit`, form({ note: 'Added results' }, { file: { blob: pdfBlob('v2'), name: 'week1-v2.pdf' } }));
  assert.equal(re.status, 201, JSON.stringify(re.body));
  assert.equal((await S.bob.call('POST', `/api/reports/${S.reportId}/resubmit`, form({}, { file: { blob: pdfBlob(), name: 'a.pdf' } }))).status, 403);
  assert.equal((await S.sup.post(`/api/reports/${S.reportId}/review`, { decision: 'approved', comments: 'Good.' })).status, 200);
  const detail = await S.alice.get(`/api/reports/${S.reportId}`);
  assert.equal(detail.body.data.versions.length, 2);
  assert.equal(detail.body.data.reviews.length, 2);
  assert.equal(detail.body.data.report.status, 'approved');
  // approved reports cannot be resubmitted
  assert.equal((await S.alice.call('POST', `/api/reports/${S.reportId}/resubmit`, form({}, { file: { blob: pdfBlob(), name: 'a.pdf' } }))).status, 409);
});

test('milestones, interaction log, meeting', async () => {
  const ms = await S.sup.post('/api/milestones', { projectId: S.projectId, title: 'Prototype', plannedDate: new Date(Date.now() + 5 * 86400000).toISOString() });
  assert.equal(ms.status, 201, JSON.stringify(ms.body));
  assert.equal((await S.alice.patch(`/api/milestones/${ms.body.data._id}`, { status: 'completed' })).status, 403, 'students cannot change milestones');
  const upd = await S.sup.patch(`/api/milestones/${ms.body.data._id}`, { status: 'in_progress', progress: 40 });
  assert.equal(upd.status, 200, JSON.stringify(upd.body));
  const log = await S.bob.post('/api/interaction-logs', { projectId: S.projectId, title: 'Question', description: 'Which DB should we use?' });
  assert.equal(log.status, 201, JSON.stringify(log.body));
  assert.equal((await S.sup.post(`/api/interaction-logs/${log.body.data._id}/responses`, { message: 'MongoDB.' })).status, 200);
  const mt = await S.sup.post('/api/meetings', { projectId: S.projectId, title: 'Sprint review', scheduledAt: new Date(Date.now() + 86400000).toISOString() });
  assert.equal(mt.status, 201, JSON.stringify(mt.body));
  assert.equal((await S.alice.get(`/api/meetings?project=${S.projectId}`)).body.data.length, 1);
  const run = await S.coord.post('/api/notifications/run-reminders');
  assert.equal(run.status, 200);
});

test('feedback threads keep formal decisions separate from chat', async () => {
  const t = await S.alice.post('/api/feedback', { projectId: S.projectId, title: 'Design question', body: 'Is the ER diagram fine?' });
  assert.equal(t.status, 201, JSON.stringify(t.body));
  assert.equal((await S.sup.post(`/api/feedback/${t.body.data._id || t.body.data.thread?._id}/comments`, { body: 'Looks good.' })).status, 201);
  const list = await S.alice.get(`/api/feedback?project=${S.projectId}`);
  assert.equal(list.status, 200, JSON.stringify(list.body));
  assert.ok(list.body.data.length >= 2); // proposal + report formal threads and the general one
  assert.ok(list.body.data.some((x) => x.kind === 'proposal'));
});

test('chat: persistence and conversation access restrictions', async () => {
  const convs = await S.alice.get('/api/conversations');
  assert.equal(convs.body.data.length, 2);
  const sup = convs.body.data.find((c) => c.type === 'supervision');
  const grp = convs.body.data.find((c) => c.type === 'group');
  const sent = await S.alice.call('POST', `/api/conversations/${sup._id}/messages`, form({ text: 'Hello supervisor' }));
  assert.equal(sent.status, 201, JSON.stringify(sent.body));
  assert.equal((await S.alice.call('POST', `/api/conversations/${grp._id}/messages`, form({ text: 'x'.repeat(2001) }))).status, 422);
  const supConvs = await S.sup.get('/api/conversations');
  assert.equal(supConvs.body.data.length, 1, 'supervisor sees only the supervision chat');
  assert.equal(supConvs.body.data[0].unread, 1);
  assert.equal((await S.sup.get(`/api/conversations/${grp._id}/messages`)).status, 404, 'supervisor cannot read the students-only chat');
  assert.equal((await S.chitra.get(`/api/conversations/${sup._id}/messages`)).status, 404, 'outsider cannot guess a conversation id');
  assert.equal((await S.sup2.call('POST', `/api/conversations/${sup._id}/messages`, form({ text: 'hi' }))).status, 404);
  const msgs = await S.sup.get(`/api/conversations/${sup._id}/messages`);
  assert.equal(msgs.body.data.length, 1);
  assert.equal(msgs.body.data[0].text, 'Hello supervisor');
  await S.sup.post(`/api/conversations/${sup._id}/read`);
  assert.equal((await S.sup.get('/api/conversations')).body.data[0].unread, 0);
});

test('final report, evaluation (supervisor + external), results publication', async () => {
  const elig = await S.alice.get(`/api/reports/final-eligibility/${S.projectId}`);
  assert.equal(elig.body.data.eligible, true, JSON.stringify(elig.body));
  const fin = await S.alice.call('POST', '/api/reports', form({ project: S.projectId, kind: 'final', title: 'Final report' }, { file: { blob: pdfBlob('final'), name: 'final.pdf' } }));
  assert.equal(fin.status, 201, JSON.stringify(fin.body));
  const finalId = fin.body.data.report?._id || fin.body.data._id;
  assert.equal((await S.sup.post(`/api/reports/${finalId}/review`, { decision: 'approved', comments: 'Excellent.' })).status, 200);
  const proj = await S.coord.get(`/api/projects/${S.projectId}`);
  assert.equal(proj.body.data.project.status, 'ready_for_evaluation');

  const rubrics = (await S.coord.get('/api/evaluations/rubrics')).body.data;
  const supRubric = rubrics.find((r) => r.appliesTo.includes('supervisor'));
  const extRubric = rubrics.find((r) => r.appliesTo.includes('external'));
  const formUrl = `/api/evaluations/form/${S.projectId}/${supRubric._id}`;
  const f = await S.sup.get(formUrl);
  assert.equal(f.status, 200, JSON.stringify(f.body));
  const scores = supRubric.criteria.map((c) => ({ criterionId: c._id, marks: c.maxMarks - 2 }));
  const tooHigh = [{ criterionId: supRubric.criteria[0]._id, marks: 999 }, ...scores.slice(1)];
  assert.equal((await S.sup.post(`${formUrl}/submit`, { scores: tooHigh })).status, 422);
  assert.equal((await S.sup.post(`${formUrl}/submit`, { scores, remarks: 'Strong' })).status, 200);
  assert.equal((await S.sup.put(formUrl, { scores })).status, 409, 'submitted evaluation is final');
  assert.equal((await S.alice.get(formUrl)).status, 403);

  // external evaluator
  const inv = await S.coord.post('/api/external-evaluators', { name: 'Dr. Ext', email: 'ext@uni.test', organization: 'Other Uni', rubricId: extRubric._id, projectIds: [S.projectId], expiresAt: new Date(Date.now() + 7 * 86400000).toISOString() });
  assert.equal(inv.status, 201, JSON.stringify(inv.body));
  const ext = new Client();
  await ext.login('ext@uni.test', inv.body.data.temporaryPassword);
  assert.equal((await ext.get('/api/evaluations/mine')).status, 403, 'must change the temporary password first');
  assert.equal((await ext.post('/api/auth/change-password', { currentPassword: inv.body.data.temporaryPassword, newPassword: 'NewPass123' })).status, 200);
  const mine = await ext.get('/api/evaluations/mine');
  assert.equal(mine.body.data.length, 1);
  assert.equal((await ext.get('/api/reports?limit=5')).status, 403);
  assert.equal((await ext.get(`/api/groups/${S.group._id}`)).status, 403);
  assert.equal((await ext.get('/api/conversations')).status, 403);
  const extForm = `/api/evaluations/form/${S.projectId}/${extRubric._id}`;
  const extScores = extRubric.criteria.map((c) => ({ criterionId: c._id, marks: c.maxMarks - 5 }));
  assert.equal((await ext.post(`${extForm}/submit`, { scores: extScores, remarks: 'Good' })).status, 200);
  assert.equal((await ext.get(`/api/evaluations/form/${S.projectId}/${supRubric._id}`)).status, 404, 'cannot use a rubric it was not assigned');

  // students see nothing until the coordinator publishes; results stay separate per evaluator
  assert.equal((await S.alice.get('/api/evaluations/my-results')).body.data.published, false);
  const res = await S.coord.get(`/api/evaluations/results/${S.projectId}`);
  assert.equal(res.body.data.results.reduce((n, r) => n + r.evaluations.length, 0), 2);
  assert.equal((await S.coord.post(`/api/evaluations/results/${S.projectId}/publish`, { publish: true })).status, 200);
  const mineRes = await S.alice.get('/api/evaluations/my-results');
  assert.equal(mineRes.body.data.published, true);

  // revoke access: evaluator is locked out but the record is preserved
  const list = await S.coord.get('/api/external-evaluators');
  assert.equal((await S.coord.post(`/api/external-evaluators/${list.body.data[0]._id}/revoke`)).status, 200);
  assert.equal((await ext.get('/api/evaluations/mine')).body.data?.length ?? 0, 0);
  assert.equal((await S.coord.get(`/api/evaluations/results/${S.projectId}`)).body.data.results.length > 0, true);
});

test('coordinator dashboards, analytics, exports, settings, repository, announcements', async () => {
  for (const p of ['/api/dashboard/coordinator', '/api/analytics', '/api/system/info', '/api/settings', '/api/audit-logs', '/api/groups', '/api/projects', '/api/proposals', '/api/reports']) {
    const r = await S.coord.get(p);
    assert.equal(r.status, 200, `${p}: ${JSON.stringify(r.body)}`);
  }
  assert.equal((await S.alice.get('/api/dashboard/student')).status, 200);
  assert.equal((await S.sup.get('/api/dashboard/supervisor')).status, 200);
  const csv = await S.coord.raw('GET', '/api/analytics/export/projects.csv');
  assert.equal(csv.status, 200);
  assert.match(await csv.text(), /Smart Campus Navigation/);
  assert.equal((await S.coord.put('/api/settings', { maxGroupSize: 99 })).status, 422);
  assert.equal((await S.coord.put('/api/settings', { maxGroupSize: 5 })).status, 200);

  const up = await S.coord.call('POST', '/api/repository', form({ title: 'Report template', category: 'template' }, { file: { blob: pdfBlob('tmpl'), name: 'template.pdf' } }));
  assert.equal(up.status, 201, JSON.stringify(up.body));
  assert.equal((await S.alice.get('/api/repository')).body.data.length, 1);
  assert.equal((await S.alice.raw('GET', `/api/repository/${up.body.data._id}/download`)).status, 200);
  assert.equal((await S.alice.call('POST', '/api/repository', form({ title: 'x' }, { file: { blob: pdfBlob(), name: 'a.pdf' } }))).status, 403);

  const ann = await S.coord.post('/api/announcements', { title: 'Welcome', body: 'Semester starts', roles: ['student'] });
  assert.equal(ann.status, 201, JSON.stringify(ann.body));

  // deactivated users lose access immediately
  const users = await S.coord.get('/api/users?role=student&q=chitra');
  const chitraId = users.body.data[0]._id;
  assert.equal((await S.coord.patch(`/api/users/${chitraId}/status`, { isActive: false })).status, 200);
  assert.equal((await S.chitra.get('/api/auth/me')).status, 401);
});

test('one login page for all roles: role must match, supervisors need approval, one coordinator only', async () => {
  const anon = () => new Client();
  // wrong role selected -> clear message, right role works
  const wrong = await anon().post('/api/auth/login', { email: 'alice@apmms.test', password: 'Demo@12345', role: 'supervisor' });
  assert.equal(wrong.status, 403);
  assert.match(wrong.body.message, /Student/);
  assert.equal((await anon().post('/api/auth/login', { email: 'alice@apmms.test', password: 'Demo@12345', role: 'student' })).status, 200);
  // a wrong password never reveals the real role
  assert.equal((await anon().post('/api/auth/login', { email: 'alice@apmms.test', password: 'nope', role: 'supervisor' })).status, 401);

  // supervisor self-signup is pending: no session, cannot log in, coordinator is notified
  const opts = (await anon().get('/api/auth/registration-options')).body.data;
  const inst = opts.institutions.find((i) => i.name === 'Demo University');
  const depId = inst.departments[0]._id;
  const institutionId = inst._id;
  assert.equal(opts.platform.allowInstitutionRegistration, true);
  const reg = await anon().post('/api/auth/register', { name: 'Dr New Sup', email: 'newsup@apmms.test', password: 'Passw0rd1', role: 'supervisor', institutionId, departmentId: depId, designation: 'Lecturer' });
  assert.equal(reg.status, 201, JSON.stringify(reg.body));
  assert.equal(reg.body.data.pending, true);
  await verifyFromOutbox('newsup@apmms.test');
  const tryLogin = await anon().post('/api/auth/login', { email: 'newsup@apmms.test', password: 'Passw0rd1', role: 'supervisor' });
  assert.equal(tryLogin.status, 403);
  assert.match(tryLogin.body.message, /waiting/);

  const coord = await loggedIn('coordinator@apmms.test');
  const pending = await coord.get('/api/users?approval=pending');
  assert.equal(pending.body.data.length, 1);
  const pid = pending.body.data[0]._id;
  assert.equal((await coord.patch(`/api/users/${pid}/status`, { isActive: true })).status, 409, 'cannot skip approval');
  assert.ok((await coord.get('/api/notifications')).body.data.some((n) => n.type === 'approval_request'));
  assert.equal((await loggedIn('alice@apmms.test').then((c) => c.post(`/api/users/${pid}/approval`, { decision: 'approve' }))).status, 403);
  assert.equal((await coord.post(`/api/users/${pid}/approval`, { decision: 'approve' })).status, 200);
  assert.equal((await anon().post('/api/auth/login', { email: 'newsup@apmms.test', password: 'Passw0rd1', role: 'supervisor' })).status, 200);
  assert.equal((await coord.post(`/api/users/${pid}/approval`, { decision: 'approve' })).status, 409, 'already decided');

  // a second rejected request
  await anon().post('/api/auth/register', { name: 'Rej', email: 'rej@apmms.test', password: 'Passw0rd1', role: 'supervisor', institutionId, departmentId: depId });
  await verifyFromOutbox('rej@apmms.test');
  const rid = (await coord.get('/api/users?approval=pending')).body.data[0]._id;
  assert.equal((await coord.post(`/api/users/${rid}/approval`, { decision: 'reject', note: 'Not on staff list' })).status, 200);
  assert.match((await anon().post('/api/auth/login', { email: 'rej@apmms.test', password: 'Passw0rd1' })).body.message, /not approved/);

  // a new coordinator registers a NEW institution; it activates when the email is verified (no setup code, nobody approves)
  const c1 = await anon().post('/api/auth/register', { name: 'Fake Boss', email: 'boss@apmms.test', password: 'Passw0rd1', role: 'coordinator', institutionName: 'Boss College' });
  assert.equal(c1.status, 201);
  assert.equal(c1.body.data.pending, true);
  // and a name that is already taken is refused
  assert.equal((await anon().post('/api/auth/register', { name: 'Copy', email: 'copy@apmms.test', password: 'Passw0rd1', role: 'coordinator', institutionName: 'demo   university' })).status, 409);
  // students still work and cannot pick a hidden role value
  assert.equal((await anon().post('/api/auth/register', { name: 'Hack', email: 'hack@apmms.test', password: 'Passw0rd1', role: 'admin', institutionId, departmentId: depId })).status, 422);
});

test('calendar, similar projects and PDF reports respect who may see what', async () => {
  const from = new Date(Date.now() - 10 * 864e5).toISOString();
  const to = new Date(Date.now() + 30 * 864e5).toISOString();
  const cal = await S.alice.get(`/api/calendar?from=${from}&to=${to}`);
  assert.equal(cal.status, 200);
  assert.ok(cal.body.data.length >= 1, 'milestones or meetings appear');
  assert.equal((await S.alice.get(`/api/calendar?from=${from}&to=${new Date(Date.now() + 900 * 864e5).toISOString()}`)).status, 422, 'range is limited');
  assert.equal((await S.sup2.get(`/api/calendar?from=${from}&to=${to}`)).body.data.filter((e) => e.projectId).length, 0, 'other supervisor sees nothing of this project');

  const sim = await S.alice.get(`/api/proposals/project/${S.projectId}/similar`);
  assert.equal(sim.status, 200);
  assert.equal(sim.body.data.checked, true);
  assert.equal((await S.sup2.get(`/api/proposals/project/${S.projectId}/similar`)).status, 404);

  const pdf = await S.coord.raw('GET', `/api/evaluations/results/${S.projectId}/report.pdf`);
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers.get('content-type'), 'application/pdf');
  assert.match(await pdf.text(), /^%PDF-/);
  const studentPdf = await S.alice.raw('GET', `/api/evaluations/results/${S.projectId}/report.pdf`);
  assert.ok([200, 403].includes(studentPdf.status));
  if (studentPdf.status === 200) {
    const proj = await S.coord.get(`/api/projects/${S.projectId}`);
    assert.equal(proj.body.data.project.resultsPublished, true, 'students only get the PDF after publishing');
  }
  assert.equal((await new Client().raw('GET', `/api/evaluations/results/${S.projectId}/report.pdf`)).status, 401);
  const ap = await S.coord.raw('GET', '/api/analytics/export/analytics.pdf');
  assert.equal(ap.status, 200);
  assert.match(await ap.text(), /^%PDF-/);
  assert.equal((await S.alice.raw('GET', '/api/analytics/export/analytics.pdf')).status, 403);
});
