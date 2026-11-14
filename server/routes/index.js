// All REST routes in one place so you can see every endpoint and who may call it.
//   authenticate  = must be logged in
//   authorize(..) = role-based access control (checked on the server, not just hidden in the UI)
// Fine-grained rules (group leader, assigned supervisor, project membership) live in services/access.js.
import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth.js';
import { platformAuthenticate } from '../middleware/platformAuth.js';
import { loginLimiter, sensitiveLimiter, verifyLimiter, resendLimiter } from '../middleware/security.js';
import { validate } from '../utils/validate.js';
import { upload } from '../services/storage.js';

import * as auth from '../controllers/authController.js';
import * as insights from '../controllers/insightsController.js';
import * as pdf from '../controllers/pdfController.js';
import * as users from '../controllers/userController.js';
import * as institutions from '../controllers/institutionController.js';
import * as platform from '../controllers/platformController.js';
import * as academic from '../controllers/academicController.js';
import * as groups from '../controllers/groupController.js';
import * as projects from '../controllers/projectController.js';
import * as proposals from '../controllers/proposalController.js';
import * as reports from '../controllers/reportController.js';
import * as monitoring from '../controllers/monitoringController.js';
import * as feedback from '../controllers/feedbackController.js';
import * as chat from '../controllers/chatController.js';
import * as notifications from '../controllers/notificationController.js';
import * as evaluation from '../controllers/evaluationController.js';
import * as external from '../controllers/externalEvaluatorController.js';
import * as repository from '../controllers/repositoryController.js';
import * as dashboard from '../controllers/dashboardController.js';
import { runReminders } from '../services/reminders.js';
import { ok, asyncHandler } from '../utils/helpers.js';

const r = Router();
const any = authenticate;
const student = [authenticate, authorize('student')];
const supervisor = [authenticate, authorize('supervisor')];
const coordinator = [authenticate, authorize('coordinator')];
const staff = [authenticate, authorize('supervisor', 'coordinator')];
const internal = [authenticate, authorize('student', 'supervisor', 'coordinator')];

const S = {
  email: { type: 'email', required: true, label: 'Email' },
  id: (label, required = false) => ({ type: 'objectId', required, label }),
};

// ---------------------------------------------------------------- auth
r.post('/auth/login', loginLimiter, validate({ email: S.email, password: { required: true, max: 100, label: 'Password' }, role: { type: 'enum', values: ['student', 'supervisor', 'coordinator', 'evaluator'] } }), auth.login);
r.post('/auth/logout', auth.logout);
r.get('/auth/me', any, auth.me);
r.get('/auth/registration-options', auth.registrationOptions);
r.post(
  '/auth/register',
  sensitiveLimiter,
  validate({
    name: { required: true, min: 2, max: 120, label: 'Name' },
    email: S.email,
    password: { required: true, max: 100, label: 'Password' },
    role: { type: 'enum', values: ['student', 'supervisor', 'coordinator'] },
    studentId: { max: 40, label: 'Student ID' },
    departmentId: S.id('Department'),
    institutionId: S.id('Institution'),
    institutionName: { max: 160, label: 'Institution name' },
    institutionType: { type: 'enum', values: ['university', 'college', 'school', 'institute', 'training_center', 'other'] },
    departmentName: { max: 120, label: 'Department name' },
    designation: { max: 100 },
    setupCode: { max: 100 },
  }),
  auth.register
);
r.post('/auth/verify-email', verifyLimiter, validate({ token: { required: true, max: 200 } }), auth.verifyEmail);
r.post('/auth/resend-verification', resendLimiter, validate({ email: S.email }), auth.resendVerification);
r.post('/auth/onboarding-seen', any, auth.onboardingSeen);
r.post('/auth/delete-account', coordinator, validate({ password: { required: true, max: 100, label: 'Password' }, confirmText: { required: true, max: 20 } }), auth.deleteMyAccount);
r.post('/auth/forgot-password', sensitiveLimiter, validate({ email: S.email }), auth.forgotPassword);
r.post('/auth/reset-password', sensitiveLimiter, validate({ token: { required: true, max: 200 }, password: { required: true, max: 100 } }), auth.resetPassword);
r.post('/auth/change-password', any, validate({ currentPassword: { required: true, max: 100 }, newPassword: { required: true, max: 100 } }), auth.changePassword);
r.patch(
  '/auth/profile',
  any,
  validate({
    name: { min: 2, max: 120 },
    phone: { max: 30 },
    bio: { max: 600 },
    designation: { max: 100 },
    expertise: { type: 'array', maxItems: 12, of: { max: 60 } },
    notificationPrefs: { type: 'object' },
  }),
  auth.updateProfile
);

// ---------------------------------------------------------------- users (coordinator) + lookup
r.post('/institutions/mine/delete', coordinator, validate({ password: { required: true, max: 100 }, confirmName: { required: true, max: 200 }, eraseNow: { type: 'boolean' } }), institutions.deleteMyInstitution);
r.get('/users', coordinator, users.listUsers);
r.get('/users/lookup-student', student, users.lookupStudent);
r.get('/users/supervisors', coordinator, (req, _res, next) => {
  req.query.role = 'supervisor';
  req.query.withWorkload = '1';
  req.query.limit = req.query.limit || '100';
  next();
}, users.listUsers);
r.post(
  '/users',
  coordinator,
  validate({
    name: { required: true, min: 2, max: 120 },
    email: S.email,
    role: { type: 'enum', values: ['student', 'supervisor', 'coordinator'], required: true },
    departmentId: S.id('Department'),
    termId: S.id('Term'),
    studentId: { max: 40 },
    phone: { max: 30 },
    designation: { max: 100 },
    maxProjects: { type: 'number', min: 1, max: 50 },
    password: { max: 100 },
  }),
  users.createUser
);
r.get('/users/:id', coordinator, users.getUser);
r.patch(
  '/users/:id',
  coordinator,
  validate({
    name: { min: 2, max: 120 },
    phone: { max: 30 },
    departmentId: S.id('Department'),
    termId: S.id('Term'),
    studentId: { max: 40 },
    designation: { max: 100 },
    maxProjects: { type: 'number', min: 1, max: 50 },
  }),
  users.updateUser
);
r.post('/users/:id/approval', coordinator, validate({ decision: { type: 'enum', values: ['approve', 'reject'], required: true }, note: { max: 300 } }), users.decideApproval);
r.patch('/users/:id/status', coordinator, validate({ isActive: { type: 'boolean', required: true } }), users.setUserStatus);
r.post('/users/:id/mark-verified', coordinator, auth.markEmailVerified);
r.post('/users/:id/reset-password', coordinator, users.resetUserPassword);

// ---------------------------------------------------------------- departments, terms, settings
const depRules = (req) => ({
  name: { required: req, min: 2, max: 120 },
  code: { required: req, min: 2, max: 12 },
  description: { max: 500 },
  isActive: { type: 'boolean' },
});
r.get('/departments', any, academic.listDepartments);
r.post('/departments', coordinator, validate(depRules(true)), academic.createDepartment);
r.patch('/departments/:id', coordinator, validate(depRules(false)), academic.updateDepartment);

const termRules = (req) => ({
  name: { required: req, min: 2, max: 80 },
  academicYear: { required: req, max: 20, label: 'Academic year' },
  semester: { required: req, max: 30 },
  startDate: { type: 'date', required: req, label: 'Start date' },
  endDate: { type: 'date', required: req, label: 'End date' },
  isCurrent: { type: 'boolean' },
  isActive: { type: 'boolean' },
  proposalDeadline: { type: 'date', label: 'Proposal deadline' },
  finalReportDeadline: { type: 'date', label: 'Final report deadline' },
});
r.get('/academic-terms', any, academic.listTerms);
r.post('/academic-terms', coordinator, validate(termRules(true)), academic.createTerm);
r.patch('/academic-terms/:id', coordinator, validate(termRules(false)), academic.updateTerm);

r.get('/settings', coordinator, academic.readSettings);
r.put('/settings', coordinator, academic.saveSettings);

// ---------------------------------------------------------------- groups
r.get('/groups/mine', student, groups.getMyGroups);
r.post('/groups/join', student, validate({ code: { required: true, min: 4, max: 12 } }), groups.joinByCode);
r.post('/groups/invitations/:id/respond', student, validate({ accept: { type: 'boolean', required: true } }), groups.respondToInvitation);
r.delete('/groups/invitations/:id', student, groups.cancelInvitation);
r.post('/groups', student, validate({ name: { required: true, min: 3, max: 80, label: 'Group name' } }), groups.createGroup);
r.get('/groups', coordinator, groups.listGroups);
r.get('/groups/:id', internal, groups.getGroup);
r.post('/groups/:id/invite', student, validate({ email: S.email }), groups.inviteMember);
r.post('/groups/:id/leave', student, groups.leaveGroup);
r.post('/groups/:id/transfer-leadership', student, validate({ userId: S.id('Member', true) }), groups.transferLeadership);
r.post('/groups/:id/remove-member', student, validate({ userId: S.id('Member', true) }), groups.removeMember);
r.patch(
  '/groups/:id/admin',
  coordinator,
  validate({
    action: { type: 'enum', values: ['archive', 'add_member', 'remove_member', 'set_leader'], required: true },
    userId: S.id('Student'),
    moveFromOtherGroup: { type: 'boolean' },
  }),
  groups.adminUpdateGroup
);

// ---------------------------------------------------------------- projects
r.get('/projects', staff, projects.listProjects);
r.get('/projects/mine', student, projects.myProject);
r.get('/projects/:id', any, projects.getProject);
r.get('/projects/:id/timeline', internal, projects.projectTimeline);
r.patch(
  '/projects/:id',
  [authenticate, authorize('student', 'coordinator')],
  validate({ title: { min: 3, max: 200 }, summary: { max: 2000 }, technologies: { type: 'array', maxItems: 20, of: { max: 60 } } }),
  projects.updateProject
);
r.put('/projects/:id/supervisor', coordinator, validate({ supervisorId: S.id('Supervisor', true), force: { type: 'boolean' } }), projects.assignSupervisor);
r.patch('/projects/:id/status', coordinator, validate({ status: { required: true, max: 40 } }), projects.setProjectStatus);

// ---------------------------------------------------------------- proposals
const proposalFields = {
  title: { max: 200 },
  abstract: { max: 4000 },
  problemStatement: { max: 4000 },
  objectives: { max: 4000 },
  methodology: { max: 4000 },
  expectedOutcomes: { max: 4000 },
  technologyStack: { type: 'array', maxItems: 20, of: { max: 60 } },
};
r.get('/proposals', staff, proposals.listProposals);
r.get('/proposals/project/:projectId', internal, proposals.getProposal);
r.put('/proposals/project/:projectId/draft', student, validate(proposalFields), proposals.saveDraft);
r.post('/proposals/project/:projectId/attachments', student, upload.array('attachments', 5), proposals.uploadDraftAttachments);
r.delete('/proposals/project/:projectId/attachments/:index', student, proposals.removeDraftAttachment);
r.post('/proposals/project/:projectId/submit', student, proposals.submitProposal);
r.get('/proposals/project/:projectId/versions/:version/attachments/:index', internal, proposals.downloadAttachment);
r.get('/proposals/:id', staff, proposals.getProposalById);
r.post('/proposals/:id/start-review', staff, proposals.startReview);
r.post(
  '/proposals/:id/review',
  staff,
  validate({ decision: { type: 'enum', values: ['approved', 'rejected', 'revision_required'], required: true }, comments: { max: 4000 } }),
  proposals.reviewProposal
);

// ---------------------------------------------------------------- reports (progress + final)
const reportUpload = upload.fields([{ name: 'file', maxCount: 1 }, { name: 'attachments', maxCount: 5 }]);
r.get('/reports', authenticate, authorize('student', 'supervisor', 'coordinator'), reports.listReports);
r.get('/reports/export.csv', coordinator, reports.exportReportsCsv);
r.get('/reports/final-eligibility/:projectId', student, reports.getFinalEligibility);
r.post('/reports', student, reportUpload, reports.createReport);
r.get('/reports/:id', any, reports.getReport);
r.patch('/reports/:id', student, reportUpload, reports.updateDraft);
r.post('/reports/:id/submit', student, reports.submitDraft);
r.post('/reports/:id/resubmit', student, reportUpload, reports.resubmit);
r.post('/reports/:id/start-review', staff, reports.startReportReview);
r.post(
  '/reports/:id/review',
  staff,
  validate({ decision: { type: 'enum', values: ['approved', 'rejected', 'revision_required'], required: true }, comments: { max: 4000 } }),
  reports.reviewReport
);
r.get('/reports/:id/versions/:version/file', any, reports.downloadReportFile);
r.get('/reports/:id/versions/:version/attachments/:index', any, reports.downloadReportAttachment);

// ---------------------------------------------------------------- milestones, logs, meetings
r.get('/milestones', internal, monitoring.listMilestones);
r.get('/milestones/progress-overview', staff, monitoring.progressOverview);
r.post(
  '/milestones',
  staff,
  validate({ projectId: S.id('Project', true), title: { required: true, min: 3, max: 160 }, description: { max: 1000 }, plannedDate: { type: 'date', required: true, label: 'Planned date' } }),
  monitoring.createMilestone
);
r.patch(
  '/milestones/:id',
  internal,
  validate({
    title: { min: 3, max: 160 },
    description: { max: 1000 },
    plannedDate: { type: 'date' },
    status: { type: 'enum', values: ['pending', 'in_progress', 'completed', 'skipped'] },
    progress: { type: 'number', min: 0, max: 100 },
    remarks: { max: 1000 },
  }),
  monitoring.updateMilestone
);
r.delete('/milestones/:id', staff, monitoring.deleteMilestone);

r.get('/interaction-logs', internal, monitoring.listLogs);
r.post(
  '/interaction-logs',
  student,
  validate({ projectId: S.id('Project', true), type: { type: 'enum', values: ['update', 'discussion', 'issue', 'request'], default: 'update' }, title: { required: true, min: 3, max: 160 }, description: { required: true, min: 3, max: 3000 } }),
  monitoring.createLog
);
r.post('/interaction-logs/:id/responses', internal, validate({ message: { required: true, min: 1, max: 2000 } }), monitoring.respondToLog);
r.patch('/interaction-logs/:id/status', internal, validate({ status: { type: 'enum', values: ['open', 'responded', 'closed'], required: true } }), monitoring.setLogStatus);

r.get('/meetings', internal, monitoring.listMeetings);
r.post(
  '/meetings',
  staff,
  validate({
    projectId: S.id('Project', true),
    title: { required: true, min: 3, max: 160 },
    agenda: { max: 2000 },
    scheduledAt: { type: 'date', required: true, label: 'Date and time' },
    durationMin: { type: 'number', min: 5, max: 600 },
    location: { max: 200 },
  }),
  monitoring.createMeeting
);
r.patch(
  '/meetings/:id',
  staff,
  validate({
    title: { min: 3, max: 160 },
    agenda: { max: 2000 },
    scheduledAt: { type: 'date' },
    durationMin: { type: 'number', min: 5, max: 600 },
    location: { max: 200 },
    status: { type: 'enum', values: ['scheduled', 'completed', 'cancelled'] },
    minutes: { max: 5000 },
    actionItems: { type: 'array', maxItems: 30, of: { type: 'object' } },
  }),
  monitoring.updateMeeting
);

// ---------------------------------------------------------------- feedback
r.get('/feedback', internal, feedback.listThreads);
r.post('/feedback', internal, validate({ projectId: S.id('Project', true), title: { required: true, min: 3, max: 160 }, body: { required: true, min: 1, max: 4000 } }), feedback.createThread);
r.get('/feedback/:id', internal, feedback.getThread);
r.post('/feedback/:id/comments', internal, validate({ body: { required: true, min: 1, max: 4000 } }), feedback.addComment);
r.patch('/feedback/:id/status', internal, validate({ status: { type: 'enum', values: ['open', 'closed'], required: true } }), feedback.setThreadStatus);

// ---------------------------------------------------------------- chat
r.get('/conversations', internal, chat.listConversations);
r.get('/conversations/:id/messages', internal, chat.getMessages);
r.post('/conversations/:id/messages', internal, upload.array('attachments', 3), chat.sendMessage);
r.post('/conversations/:id/read', internal, chat.markRead);
r.get('/conversations/:id/messages/:messageId/attachments/:index', internal, chat.downloadChatAttachment);

// ---------------------------------------------------------------- similar projects + calendar
r.get('/proposals/project/:projectId/similar', internal, insights.similarProjects);
r.get('/calendar', any, insights.calendar);

// ---------------------------------------------------------------- notifications + announcements
r.get('/notifications', any, notifications.listNotifications);
r.get('/notifications/unread-count', any, notifications.unreadCount);
r.post('/notifications/read-all', any, notifications.markAllRead);
r.patch('/notifications/:id/read', any, notifications.markRead);
r.get('/announcements', coordinator, notifications.listAnnouncements);
r.post(
  '/announcements',
  coordinator,
  validate({
    title: { required: true, min: 3, max: 160 },
    body: { required: true, min: 3, max: 3000 },
    roles: { type: 'array', maxItems: 3, of: { type: 'enum', values: ['student', 'supervisor', 'coordinator'] } },
    departments: { type: 'array', maxItems: 50, of: { type: 'objectId' } },
    terms: { type: 'array', maxItems: 50, of: { type: 'objectId' } },
    projects: { type: 'array', maxItems: 200, of: { type: 'objectId' } },
  }),
  notifications.createAnnouncement
);
r.post('/notifications/run-reminders', coordinator, asyncHandler(async (_req, res) => ok(res, await runReminders())));

// ---------------------------------------------------------------- evaluation
const rubricRules = (req) => ({
  name: { required: req, min: 3, max: 120 },
  stage: { required: req, min: 2, max: 60 },
  description: { max: 500 },
  criteria: { type: 'array', required: req, maxItems: 30, of: { type: 'object' } },
  appliesTo: { type: 'array', maxItems: 2, of: { type: 'enum', values: ['supervisor', 'external'] } },
  gradingRules: { type: 'object' },
  isActive: { type: 'boolean' },
});
r.get('/evaluations/rubrics', authenticate, authorize('coordinator', 'supervisor'), evaluation.listRubrics);
r.post('/evaluations/rubrics', coordinator, validate(rubricRules(true)), evaluation.createRubric);
r.patch('/evaluations/rubrics/:id', coordinator, validate(rubricRules(false)), evaluation.updateRubric);
r.get('/evaluations/mine', authenticate, authorize('supervisor', 'evaluator'), evaluation.myAssignments);
r.get('/evaluations/my-results', student, evaluation.myResults);
r.get('/evaluations/overview', coordinator, evaluation.resultsOverview);
r.get('/evaluations/results/:projectId', coordinator, evaluation.projectResults);
r.post('/evaluations/results/:projectId/publish', coordinator, validate({ publish: { type: 'boolean', required: true } }), evaluation.publishResults);
r.post('/evaluations/:id/reopen', coordinator, validate({ reason: { required: true, min: 5, max: 500 } }), evaluation.reopenEvaluation);
const evalBody = validate({ scores: { type: 'array', maxItems: 30, of: { type: 'object' } }, remarks: { max: 3000 } });
const evaluators = [authenticate, authorize('supervisor', 'evaluator')];
r.get('/evaluations/form/:projectId/:rubricId', evaluators, evaluation.getEvaluationForm);
r.put('/evaluations/form/:projectId/:rubricId', evaluators, evalBody, evaluation.saveEvaluationDraft);
r.post('/evaluations/form/:projectId/:rubricId/submit', evaluators, evalBody, evaluation.submitEvaluation);

// ---------------------------------------------------------------- external evaluators
r.get('/external-evaluators', coordinator, external.listAssignments);
r.post(
  '/external-evaluators',
  coordinator,
  validate({
    name: { required: true, min: 2, max: 120 },
    email: S.email,
    organization: { max: 150 },
    rubricId: S.id('Rubric', true),
    projectIds: { type: 'array', required: true, maxItems: 100, of: { type: 'objectId' } },
    expiresAt: { type: 'date', required: true, label: 'Access expiry' },
    sessionLabel: { max: 120 },
  }),
  external.createAssignment
);
r.post('/external-evaluators/:id/revoke', coordinator, external.revokeAssignment);
r.patch('/external-evaluators/:id/extend', coordinator, validate({ expiresAt: { type: 'date', required: true } }), external.extendAssignment);

// ---------------------------------------------------------------- repository
r.get('/repository', internal, repository.listResources);
r.post('/repository', coordinator, upload.single('file'), repository.createResource);
r.patch('/repository/:id/archive', coordinator, validate({ isArchived: { type: 'boolean', required: true } }), repository.archiveResource);
r.get('/repository/:id/download', internal, repository.downloadResource);

// ---------------------------------------------------------------- dashboards, analytics, audit, system
r.get('/dashboard/student', student, dashboard.studentDashboard);
r.get('/dashboard/supervisor', supervisor, dashboard.supervisorDashboard);
r.get('/dashboard/coordinator', coordinator, dashboard.coordinatorDashboard);
r.get('/analytics', coordinator, dashboard.analytics);
r.get('/analytics/export/analytics.pdf', coordinator, pdf.analyticsPdf);
r.get('/evaluations/results/:projectId/report.pdf', internal, pdf.gradeReportPdf);
r.get('/analytics/export/projects.csv', coordinator, dashboard.exportProjectsCsv);
r.get('/audit-logs', coordinator, dashboard.listAuditLogs);
r.get('/system/info', coordinator, dashboard.systemInfo);

// ---------------------------------------------------------------- platform admin console (website owner)
// Completely separate from institution users: own accounts, own cookie, no institution. See controllers/platformController.js
const padmin = platformAuthenticate;
const NAME = { required: true, min: 2, max: 120, label: 'Name' };
r.get('/platform/public', platform.publicInfo);
r.get('/platform/setup-status', platform.setupStatus);
r.post('/platform/setup', sensitiveLimiter, validate({ name: NAME, email: S.email, password: { required: true, max: 100, label: 'Password' }, setupCode: { max: 200 } }), platform.setup);
r.post('/platform/auth/login', loginLimiter, validate({ email: S.email, password: { required: true, max: 100, label: 'Password' } }), platform.login);
r.post('/platform/auth/logout', platform.logout);
r.get('/platform/auth/me', padmin, platform.me);
r.post('/platform/auth/change-password', padmin, validate({ currentPassword: { required: true, max: 100 }, newPassword: { required: true, max: 100 } }), platform.changePassword);
r.patch('/platform/auth/me', padmin, validate({ name: { min: 2, max: 120, label: 'Name' } }), platform.updateMe);
r.get('/platform/overview', padmin, platform.overview);
r.get('/platform/institutions', padmin, platform.listInstitutions);
r.get('/platform/institutions/export.csv', padmin, platform.exportInstitutions);
r.post('/platform/institutions', padmin, validate({ institutionName: { required: true, max: 160 }, institutionType: { type: 'enum', values: ['university', 'college', 'school', 'institute', 'training_center', 'other'] }, coordinatorName: NAME, coordinatorEmail: S.email }), platform.createInstitution);
r.get('/platform/institutions/:id', padmin, platform.getInstitution);
r.patch('/platform/institutions/:id', padmin, validate({ name: { max: 160 }, type: { type: 'enum', values: ['university', 'college', 'school', 'institute', 'training_center', 'other'] } }), platform.updateInstitution);
r.post('/platform/institutions/:id/decision', padmin, validate({ decision: { type: 'enum', values: ['approve', 'reject', 'suspend', 'reactivate', 'restore', 'purge'], required: true }, note: { max: 300 } }), platform.decideInstitution);
r.get('/platform/coordinators', padmin, platform.listCoordinators);
r.post('/platform/coordinators/:id/action', padmin, validate({ action: { type: 'enum', values: ['deactivate', 'reactivate', 'reset-password', 'resend-verification', 'verify-email'], required: true } }), platform.coordinatorAction);
r.get('/platform/admins', padmin, platform.listAdmins);
r.post('/platform/admins', padmin, validate({ name: NAME, email: S.email }), platform.createAdmin);
r.post('/platform/admins/:id/action', padmin, validate({ action: { type: 'enum', values: ['deactivate', 'reactivate', 'reset-password'], required: true } }), platform.adminAction);
r.get('/platform/audit', padmin, platform.listAudit);
r.get('/platform/health', padmin, platform.health);
r.get('/platform/settings', padmin, platform.getSettings);
r.put('/platform/settings', padmin, validate({ allowInstitutionRegistration: { type: 'boolean' }, loginNotice: { max: 240 } }), platform.putSettings);

export default r;
