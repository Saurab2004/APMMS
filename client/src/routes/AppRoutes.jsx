import { Navigate, Route, Routes } from 'react-router-dom';
import ProtectedRoute from './ProtectedRoute.jsx';
import AppLayout from '../components/layout/AppLayout.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { homeFor } from '../utils/format.js';

import Login from '../pages/auth/Login.jsx';
import Register from '../pages/auth/Register.jsx';
import VerifyEmail from '../pages/auth/VerifyEmail.jsx';
import ForgotPassword from '../pages/auth/ForgotPassword.jsx';
import ResetPassword from '../pages/auth/ResetPassword.jsx';
import ChangePassword from '../pages/auth/ChangePassword.jsx';
import { AccessDenied, NotFound } from '../pages/auth/StatusPages.jsx';

import StudentDashboard from '../pages/student/StudentDashboard.jsx';
import { CreateGroupPage, GroupManagePage, InvitationsPage, JoinGroupPage, PastGroupsPage } from '../pages/student/GroupPages.jsx';
import ProjectHistoryPage from '../pages/student/ProjectHistoryPage.jsx';

import SupervisorDashboard from '../pages/supervisor/SupervisorDashboard.jsx';
import { AssignedProjectsPage, EvaluationListPage, ProgressMonitoringPage } from '../pages/supervisor/SupervisorPages.jsx';

import { EvaluatorHome } from '../pages/evaluator/EvaluatorPages.jsx';

import ChatPage from '../pages/shared/ChatPage.jsx';
import FeedbackPage from '../pages/shared/FeedbackPage.jsx';
import InteractionLogsPage from '../pages/shared/InteractionLogsPage.jsx';
import MeetingsPage from '../pages/shared/MeetingsPage.jsx';
import MilestonesPage from '../pages/shared/MilestonesPage.jsx';
import NotificationsPage from '../pages/shared/NotificationsPage.jsx';
import ProjectDetailPage from '../pages/shared/ProjectDetailPage.jsx';
import { ProposalFormPage, ProposalReviewPage, ProposalStatusPage, ProposalsListPage } from '../pages/shared/ProposalPages.jsx';
import ReportDetailPage from '../pages/shared/ReportDetailPage.jsx';
import ReportFormPage from '../pages/shared/ReportFormPage.jsx';
import ReportsListPage from '../pages/shared/ReportsListPage.jsx';
import { Button } from '../components/common/ui.jsx';
import CalendarPage from '../pages/shared/CalendarPage.jsx';
import HelpPage from '../pages/shared/HelpPage.jsx';
import RepositoryPage from '../pages/shared/RepositoryPage.jsx';
import EvaluationFormPage from '../pages/shared/EvaluationFormPage.jsx';
import { AccountPage, ProfilePage, SettingsPage } from '../pages/shared/AccountForms.jsx';

import CoordinatorDashboard from '../pages/coordinator/CoordinatorDashboard.jsx';
import UsersPage from '../pages/coordinator/UsersPage.jsx';
import PlatformLayout, { PlatformGuard } from '../pages/platform/PlatformLayout.jsx';
import { PlatformChangePassword, PlatformSetup } from '../pages/platform/PlatformAuthPages.jsx';
import { PlatformInstitutionDetail, PlatformInstitutions, PlatformOverview } from '../pages/platform/PlatformPages.jsx';
import { PlatformAccount, PlatformAdmins, PlatformAudit, PlatformCoordinators, PlatformHealth, PlatformSettings } from '../pages/platform/PlatformPages2.jsx';
import { AcademicStructurePage, DepartmentsPage } from '../pages/coordinator/AcademicPages.jsx';
import GroupsAdminPage from '../pages/coordinator/GroupsAdminPage.jsx';
import { CoordinatorProjectsPage, SupervisorAssignmentPage } from '../pages/coordinator/ProjectPages.jsx';
import EvaluationManagementPage from '../pages/coordinator/EvaluationPages.jsx';
import ExternalEvaluatorsPage from '../pages/coordinator/ExternalEvaluatorsPage.jsx';
import AnalyticsPage from '../pages/coordinator/AnalyticsPage.jsx';
import { AnnouncementsPage, AuditLogsPage, RolesPage, SystemInfoPage, SystemSettingsPage } from '../pages/coordinator/AdminPages.jsx';

/** "/" and "/notifications" (used in notification links) go to the right place for the signed-in role. */
function RoleRedirect({ suffix = '' }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  const base = homeFor(user.role);
  return <Navigate to={user.role === 'evaluator' && suffix ? base : `${base}${suffix}`} replace />;
}

export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<RoleRedirect />} />
      <Route path="/notifications" element={<RoleRedirect suffix="/notifications" />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/verify-email" element={<VerifyEmail />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/access-denied" element={<AccessDenied />} />

      <Route element={<ProtectedRoute />}>
        <Route path="/change-password" element={<ChangePassword />} />
      </Route>

      <Route element={<ProtectedRoute roles={['student']} />}>
        <Route path="/student" element={<AppLayout />}>
          <Route index element={<StudentDashboard />} />
          <Route path="group" element={<GroupManagePage />} />
          <Route path="group/create" element={<CreateGroupPage />} />
          <Route path="group/join" element={<JoinGroupPage />} />
          <Route path="invitations" element={<InvitationsPage />} />
          <Route path="groups/past" element={<PastGroupsPage />} />
          <Route path="project" element={<ProjectDetailPage mine backTo="/student" base="/student" />} />
          <Route path="proposal" element={<ProposalFormPage />} />
          <Route path="proposal/status" element={<ProposalStatusPage />} />
          <Route path="reports" element={<ReportsListPage title="Progress reports" subtitle="Reports your group has submitted." kind="progress" base="/student/reports" actions={<Button to="/student/reports/new">Submit new report</Button>} />} />
          <Route path="reports/new" element={<ReportFormPage kind="progress" />} />
          <Route path="reports/:id" element={<ReportDetailPage backTo="/student/reports" />} />
          <Route path="final-report" element={<ReportFormPage kind="final" />} />
          <Route path="interaction-log" element={<InteractionLogsPage />} />
          <Route path="meetings" element={<MeetingsPage />} />
          <Route path="feedback" element={<FeedbackPage />} />
          <Route path="chat" element={<ChatPage />} />
          <Route path="repository" element={<RepositoryPage />} />
          <Route path="history" element={<ProjectHistoryPage />} />
          <Route path="notifications" element={<NotificationsPage />} />
          <Route path="profile" element={<ProfilePage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="calendar" element={<CalendarPage />} />
          <Route path="help" element={<HelpPage />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Route>

      <Route element={<ProtectedRoute roles={['supervisor']} />}>
        <Route path="/supervisor" element={<AppLayout />}>
          <Route index element={<SupervisorDashboard />} />
          <Route path="projects" element={<AssignedProjectsPage />} />
          <Route path="projects/:id" element={<ProjectDetailPage backTo="/supervisor/projects" base="/supervisor" />} />
          <Route path="monitoring" element={<ProgressMonitoringPage />} />
          <Route path="milestones" element={<MilestonesPage />} />
          <Route path="proposals" element={<ProposalsListPage base="/supervisor/proposals" pendingDefault />} />
          <Route path="proposals/:id" element={<ProposalReviewPage backTo="/supervisor/proposals" />} />
          <Route path="reports" element={<ReportsListPage title="Progress reports" subtitle="Reports from your groups." kind="progress" needsReview base="/supervisor/reports" />} />
          <Route path="reports/:id" element={<ReportDetailPage backTo="/supervisor/reports" />} />
          <Route path="final-reports" element={<ReportsListPage title="Final reports" subtitle="Final submissions from your groups." kind="final" base="/supervisor/reports" />} />
          <Route path="evaluation" element={<EvaluationListPage />} />
          <Route path="evaluation/:projectId/:rubricId" element={<EvaluationFormPage backTo="/supervisor/evaluation" />} />
          <Route path="interaction-logs" element={<InteractionLogsPage />} />
          <Route path="meetings" element={<MeetingsPage />} />
          <Route path="feedback" element={<FeedbackPage />} />
          <Route path="chat" element={<ChatPage />} />
          <Route path="notifications" element={<NotificationsPage />} />
          <Route path="profile" element={<ProfilePage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="calendar" element={<CalendarPage />} />
          <Route path="help" element={<HelpPage />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Route>

      {/* Platform admin console (website owner): separate accounts and session from every institution */}
      <Route path="/platform/setup" element={<PlatformSetup />} />
      <Route path="/platform/login" element={<Navigate to="/login" replace state={{ role: 'platform' }} />} />
      <Route element={<PlatformGuard />}>
        <Route path="/platform/change-password" element={<PlatformChangePassword />} />
        <Route path="/platform" element={<PlatformLayout />}>
          <Route index element={<PlatformOverview />} />
          <Route path="institutions" element={<PlatformInstitutions />} />
          <Route path="institutions/:id" element={<PlatformInstitutionDetail />} />
          <Route path="coordinators" element={<PlatformCoordinators />} />
          <Route path="admins" element={<PlatformAdmins />} />
          <Route path="audit" element={<PlatformAudit />} />
          <Route path="health" element={<PlatformHealth />} />
          <Route path="settings" element={<PlatformSettings />} />
          <Route path="account" element={<PlatformAccount />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Route>

      <Route element={<ProtectedRoute roles={['coordinator']} />}>
        <Route path="/coordinator" element={<AppLayout />}>
          <Route index element={<CoordinatorDashboard />} />
          <Route path="analytics" element={<AnalyticsPage />} />
          <Route path="users" element={<UsersPage />} />
          <Route path="departments" element={<DepartmentsPage />} />
          <Route path="academic" element={<AcademicStructurePage />} />
          <Route path="groups" element={<GroupsAdminPage />} />
          <Route path="assignment" element={<SupervisorAssignmentPage />} />
          <Route path="proposals" element={<ProposalsListPage base="/coordinator/proposals" />} />
          <Route path="proposals/:id" element={<ProposalReviewPage backTo="/coordinator/proposals" />} />
          <Route path="projects" element={<CoordinatorProjectsPage />} />
          <Route path="projects/:id" element={<ProjectDetailPage backTo="/coordinator/projects" base="/coordinator" />} />
          <Route path="reports" element={<ReportsListPage title="Report monitoring" subtitle="Every progress and final report in the programme." base="/coordinator/reports" />} />
          <Route path="reports/:id" element={<ReportDetailPage backTo="/coordinator/reports" />} />
          <Route path="repository" element={<RepositoryPage />} />
          <Route path="evaluations" element={<EvaluationManagementPage />} />
          <Route path="evaluators" element={<ExternalEvaluatorsPage />} />
          <Route path="announcements" element={<AnnouncementsPage />} />
          <Route path="notifications" element={<NotificationsPage />} />
          <Route path="roles" element={<RolesPage />} />
          <Route path="settings" element={<SystemSettingsPage />} />
          <Route path="system" element={<SystemInfoPage />} />
          <Route path="audit" element={<AuditLogsPage />} />
          <Route path="account" element={<AccountPage />} />
          <Route path="calendar" element={<CalendarPage />} />
          <Route path="help" element={<HelpPage />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Route>

      <Route element={<ProtectedRoute roles={['evaluator']} />}>
        <Route path="/evaluator" element={<AppLayout />}>
          <Route index element={<EvaluatorHome />} />
          <Route path="evaluate/:projectId/:rubricId" element={<EvaluationFormPage backTo="/evaluator" />} />
          <Route path="help" element={<HelpPage />} />
          <Route path="account" element={<AccountPage />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Route>

      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
