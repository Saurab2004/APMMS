// Pure business-rule tests (no database needed).
import test from 'node:test';
import assert from 'node:assert/strict';
import { canTransition, PROPOSAL_TRANSITIONS, REPORT_TRANSITIONS, isLateSubmission, isMilestoneOverdue, computeProgress, canPerformGroupAction } from '../utils/workflow.js';
import { computeEvaluation } from '../utils/scoring.js';
import { sanitizeFilename, validateUpload } from '../services/storage.js';
import { passwordProblem } from '../utils/helpers.js';
import { csvCell } from '../utils/csv.js';

test('proposal and report status transitions', () => {
  assert.ok(canTransition(PROPOSAL_TRANSITIONS, 'draft', 'submitted'));
  assert.ok(!canTransition(PROPOSAL_TRANSITIONS, 'draft', 'approved'));
  assert.ok(!canTransition(PROPOSAL_TRANSITIONS, 'approved', 'submitted'));
  assert.ok(canTransition(REPORT_TRANSITIONS, 'revision_required', 'resubmitted'));
  assert.ok(!canTransition(REPORT_TRANSITIONS, 'approved', 'resubmitted'));
});

test('late submissions, overdue milestones and progress', () => {
  assert.equal(isLateSubmission(new Date('2026-01-01'), new Date('2026-01-02')), true);
  assert.equal(isLateSubmission(new Date('2026-01-02'), new Date('2026-01-01')), false);
  assert.equal(isMilestoneOverdue({ status: 'pending', plannedDate: new Date('2000-01-01') }), true);
  assert.equal(isMilestoneOverdue({ status: 'completed', plannedDate: new Date('2000-01-01') }), false);
  assert.equal(computeProgress([{ status: 'completed' }, { status: 'in_progress', progress: 50 }]), 75);
});

test('only the group leader may perform official group actions', () => {
  assert.equal(canPerformGroupAction('leader', 'submit_report'), true);
  assert.equal(canPerformGroupAction('member', 'submit_report'), false);
});

test('password policy and filename sanitising', () => {
  assert.ok(passwordProblem('short1'));
  assert.ok(passwordProblem('onlyletters'));
  assert.equal(passwordProblem('Good1234'), null);
  assert.equal(sanitizeFilename('../../etc/passwd'), 'passwd');
  assert.equal(sanitizeFilename('..\\..\\evil<>.pdf'), 'evil.pdf');
});

test('uploads are checked by extension, MIME type AND file content', () => {
  const pdf = Buffer.from('%PDF-1.4 hello');
  assert.doesNotThrow(() => validateUpload({ buffer: pdf, size: pdf.length, originalname: 'a.pdf', mimetype: 'application/pdf' }, 'report'));
  assert.throws(() => validateUpload({ buffer: pdf, size: pdf.length, originalname: 'a.exe', mimetype: 'application/pdf' }, 'report'), /not allowed/);
  const fake = Buffer.from('MZ not a pdf');
  assert.throws(() => validateUpload({ buffer: fake, size: fake.length, originalname: 'a.pdf', mimetype: 'application/pdf' }, 'report'), /does not look like/);
  assert.throws(() => validateUpload({ buffer: pdf, size: pdf.length, originalname: 'a.pdf', mimetype: 'text/html' }, 'report'), /does not match/);
});

test('rubric marks are validated and totalled', () => {
  const rubric = { criteria: [{ _id: 'a', name: 'A', maxMarks: 10, weight: 1 }, { _id: 'b', name: 'B', maxMarks: 20, weight: 1 }], gradingRules: {} };
  const good = computeEvaluation(rubric, [{ criterionId: 'a', marks: 8 }, { criterionId: 'b', marks: 15 }]);
  assert.equal(good.errors.length, 0);
  assert.equal(good.total, 23);
  const bad = computeEvaluation(rubric, [{ criterionId: 'a', marks: 11 }, { criterionId: 'b', marks: 15 }]);
  assert.ok(bad.errors.length > 0);
});

test('CSV cells neutralise spreadsheet formulas', () => {
  assert.equal(csvCell('=1+1'), "'=1+1");
  assert.equal(csvCell('a,b'), '"a,b"');
});

import { fingerprint, similarityScore, levelFor } from '../services/similarity.js';
test('similar-project check: same idea scores high, different idea scores low', () => {
  const a = fingerprint({ title: 'Smart Campus Navigation App', abstract: 'A mobile web platform that helps new students find rooms, labs and offices on campus with indoor maps.', objectives: 'Indoor map, search, route planner' });
  const same = fingerprint({ title: 'Campus Navigation System', abstract: 'Web platform helping new students find rooms and labs on campus using indoor maps and search.', objectives: 'Indoor maps, room search, route planning' });
  const other = fingerprint({ title: 'Hospital Appointment Scheduler', abstract: 'Patients book doctor visits and receive reminders by SMS.', objectives: 'Booking, reminders, doctor calendar' });
  assert.ok(similarityScore(a, same) >= 40, `same idea: ${similarityScore(a, same)}`);
  assert.ok(similarityScore(a, other) < 25, `different idea: ${similarityScore(a, other)}`);
  assert.equal(similarityScore(a, a), 100);
  assert.equal(levelFor(70), 'high');
  assert.equal(levelFor(45), 'medium');
});
