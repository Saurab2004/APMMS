import {
  LayoutDashboard, Users, UserCircle, Settings, Bell, FolderKanban, FileText, ClipboardCheck, FileCheck2, Flag, MessageSquare,
  CalendarDays, MessagesSquare, Library, History, UsersRound, UserPlus, LogIn, Mail, Archive, Lightbulb, FilePlus2, BookOpenCheck,
  Building2, GraduationCap, UserCheck, BarChart3, Megaphone, ShieldCheck, ScrollText, Server, Award, UserCog, ListChecks, Activity, Gauge, LifeBuoy,
} from 'lucide-react';

// Every role's sidebar lives here. The server enforces permissions - this only decides what is shown.
export const NAV = {
  student: [
    { title: 'Overview', items: [
      { to: '/student', label: 'Dashboard', icon: LayoutDashboard, end: true },
      { to: '/student/calendar', label: 'Calendar', icon: CalendarDays },
    ] },
    { title: 'My project', items: [
      { to: '/student/group', label: 'My group', icon: UsersRound, badgeKey: 'invitations' },
      { to: '/student/project', label: 'Project overview', icon: FolderKanban },
      { to: '/student/proposal', label: 'Proposal', icon: Lightbulb },
      { to: '/student/reports', label: 'Progress reports', icon: FileText },
      { to: '/student/final-report', label: 'Final report', icon: FileCheck2 },
    ] },
    { title: 'Teamwork', items: [
      { to: '/student/meetings', label: 'Meetings', icon: CalendarDays },
      { to: '/student/feedback', label: 'Feedback', icon: MessageSquare },
      { to: '/student/chat', label: 'Chat', icon: MessagesSquare },
      { to: '/student/interaction-log', label: 'Interaction log', icon: ListChecks },
    ] },
    { title: 'More', items: [
      { to: '/student/repository', label: 'Templates & guides', icon: Library },
      { to: '/student/history', label: 'History & results', icon: History },
      { to: '/student/help', label: 'Help', icon: LifeBuoy },
    ] },
  ],
  supervisor: [
    { title: 'Overview', items: [
      { to: '/supervisor', label: 'Dashboard', icon: LayoutDashboard, end: true },
      { to: '/supervisor/calendar', label: 'Calendar', icon: CalendarDays },
    ] },
    { title: 'My groups', items: [
      { to: '/supervisor/projects', label: 'Assigned projects', icon: FolderKanban },
      { to: '/supervisor/monitoring', label: 'Progress monitoring', icon: Activity },
      { to: '/supervisor/milestones', label: 'Milestones', icon: Flag },
    ] },
    { title: 'Reviews', items: [
      { to: '/supervisor/proposals', label: 'Proposals', icon: ClipboardCheck },
      { to: '/supervisor/reports', label: 'Progress reports', icon: FileText },
      { to: '/supervisor/final-reports', label: 'Final reports', icon: FileCheck2 },
      { to: '/supervisor/evaluation', label: 'Evaluation', icon: Award },
    ] },
    { title: 'Teamwork', items: [
      { to: '/supervisor/meetings', label: 'Meetings', icon: CalendarDays },
      { to: '/supervisor/feedback', label: 'Feedback', icon: MessageSquare },
      { to: '/supervisor/chat', label: 'Chat', icon: MessagesSquare },
      { to: '/supervisor/interaction-logs', label: 'Interaction logs', icon: ListChecks },
      { to: '/supervisor/help', label: 'Help', icon: LifeBuoy },
    ] },
  ],
  coordinator: [
    { title: 'Overview', items: [
      { to: '/coordinator', label: 'Dashboard', icon: LayoutDashboard, end: true },
      { to: '/coordinator/analytics', label: 'Analytics', icon: BarChart3 },
      { to: '/coordinator/calendar', label: 'Calendar', icon: CalendarDays },
    ] },
    { title: 'People', items: [
      { to: '/coordinator/users', label: 'Users & approvals', icon: Users, badgeKey: 'approvals' },
      { to: '/coordinator/groups', label: 'Groups', icon: UsersRound },
      { to: '/coordinator/assignment', label: 'Supervisor assignment', icon: UserCheck },
    ] },
    { title: 'Projects', items: [
      { to: '/coordinator/projects', label: 'Project monitoring', icon: FolderKanban },
      { to: '/coordinator/proposals', label: 'Proposals', icon: ClipboardCheck },
      { to: '/coordinator/reports', label: 'Reports', icon: FileText },
      { to: '/coordinator/repository', label: 'Templates & guides', icon: Library },
    ] },
    { title: 'Evaluation', items: [
      { to: '/coordinator/evaluations', label: 'Results & rubrics', icon: Award },
      { to: '/coordinator/evaluators', label: 'External evaluators', icon: BookOpenCheck },
    ] },
    { title: 'Setup & system', items: [
      { to: '/coordinator/departments', label: 'Departments', icon: Building2 },
      { to: '/coordinator/academic', label: 'Academic terms', icon: GraduationCap },
      { to: '/coordinator/announcements', label: 'Announcements', icon: Megaphone },
      { to: '/coordinator/settings', label: 'Settings', icon: Gauge },
      { to: '/coordinator/audit', label: 'Audit logs', icon: ScrollText },
      { to: '/coordinator/system', label: 'Backup & health', icon: Server },
      { to: '/coordinator/roles', label: 'Roles & permissions', icon: ShieldCheck },
      { to: '/coordinator/help', label: 'Help', icon: LifeBuoy },
    ] },
  ],
  evaluator: [
    { title: 'Evaluation', items: [
      { to: '/evaluator', label: 'My assignments', icon: Award, end: true },
      { to: '/evaluator/help', label: 'Help', icon: LifeBuoy },
    ] },
  ],
};

export const ROLE_LABEL = { student: 'Student', supervisor: 'Supervisor', coordinator: 'Coordinator', evaluator: 'External evaluator' };

/** The sidebar for one user. The platform owner (who approves institutions) gets one extra entry. */
export function navFor(user) {
  const groups = NAV[user.role] || [];
  if (user.role === 'coordinator' && user.isPlatformOwner) {
    return [...groups, { title: 'Platform', items: [{ to: '/coordinator/institutions', label: 'Institutions', icon: Building2 }] }];
  }
  return groups;
}
