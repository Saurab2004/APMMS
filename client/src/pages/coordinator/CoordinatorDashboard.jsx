import { AlertTriangle, Award, ClipboardCheck, FileText, FolderKanban, GraduationCap, UserX, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import NextSteps from '../../components/common/NextSteps.jsx';
import { BarList, Button, Card, CardBody, CardHead, ErrorState, Loading, PageHeader, StatCard, StatusBadge } from '../../components/common/ui.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { get } from '../../services/api.js';
import { timeAgo, titleCase } from '../../utils/format.js';
import Hint from '../../components/onboarding/Hint.jsx';

export default function CoordinatorDashboard() {
  const state = useAsync(() => get('/dashboard/coordinator'), []);
  if (state.loading && !state.data) return <Loading />;
  if (state.error && !state.data) return <ErrorState message={state.error} onRetry={state.reload} />;
  const d = state.data;
  const a = d.attention;
  const todo = [
    a.pendingApprovals > 0 && { text: `Approve ${a.pendingApprovals} new account${a.pendingApprovals === 1 ? '' : 's'}`, hint: 'People are waiting to log in.', to: '/coordinator/users' },
    a.projectsWithoutSupervisor > 0 && { text: `Assign a supervisor to ${a.projectsWithoutSupervisor} project${a.projectsWithoutSupervisor === 1 ? '' : 's'}`, to: '/coordinator/assignment' },
    a.studentsWithoutGroup > 0 && { text: `${a.studentsWithoutGroup} student${a.studentsWithoutGroup === 1 ? ' has' : 's have'} no group yet`, hint: 'Remind them with an announcement, or add them to a group.', to: '/coordinator/groups' },
    a.proposalsPending > 0 && { text: `${a.proposalsPending} proposal${a.proposalsPending === 1 ? ' is' : 's are'} waiting for review`, to: '/coordinator/proposals' },
    a.reportsAwaitingReview > 0 && { text: `${a.reportsAwaitingReview} report${a.reportsAwaitingReview === 1 ? ' is' : 's are'} waiting for review`, to: '/coordinator/reports' },
    a.overdueMilestones > 0 && { text: `${a.overdueMilestones} overdue milestone${a.overdueMilestones === 1 ? '' : 's'}`, to: '/coordinator/projects' },
  ].filter(Boolean);
  return (
    <>
      <PageHeader title="Coordinator dashboard" subtitle="Programme overview and the things that need action." actions={<Button to="/coordinator/analytics" variant="secondary">Open analytics</Button>} />
      <Hint id="coordinator.dashboard" />
      <NextSteps title="Needs your action" steps={todo} emptyText="Nothing needs your action right now." />
      <div className="grid mb" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
        <StatCard icon={GraduationCap} label="Students" value={d.users.students} to="/coordinator/users" />
        <StatCard icon={Users} label="Supervisors" value={d.users.supervisors} to="/coordinator/users" />
        <StatCard icon={FolderKanban} label="Projects" value={d.projects.total} to="/coordinator/projects" />
        <StatCard icon={Award} label="Evaluations submitted" value={a.evaluationsSubmitted} to="/coordinator/evaluations" />
      </div>
      <h2 className="section-title">Needs attention</h2>
      <div className="grid mb" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
        {a.pendingApprovals > 0 && <StatCard icon={Users} label="Accounts waiting for approval" value={a.pendingApprovals} tone="warning" to="/coordinator/users" />}
        <StatCard icon={UserX} label="Projects without supervisor" value={a.projectsWithoutSupervisor} tone={a.projectsWithoutSupervisor ? 'warning' : 'success'} to="/coordinator/assignment" />
        <StatCard icon={Users} label="Students without a group" value={a.studentsWithoutGroup} tone={a.studentsWithoutGroup ? 'warning' : 'success'} to="/coordinator/groups" />
        <StatCard icon={ClipboardCheck} label="Proposals pending" value={a.proposalsPending} tone={a.proposalsPending ? 'warning' : 'success'} to="/coordinator/proposals" />
        <StatCard icon={FileText} label="Reports awaiting review" value={a.reportsAwaitingReview} tone={a.reportsAwaitingReview ? 'warning' : 'success'} to="/coordinator/reports" />
        <StatCard icon={AlertTriangle} label="Overdue milestones" value={a.overdueMilestones} tone={a.overdueMilestones ? 'danger' : 'success'} to="/coordinator/projects" />
      </div>
      <div className="grid cols-2" style={{ alignItems: 'start' }}>
        <div className="stack">
          <Card><CardHead title="Projects by stage" /><CardBody><BarList rows={d.projects.byStatus.map((s) => ({ label: titleCase(s.status), value: s.count }))} /></CardBody></Card>
          <Card><CardHead title="Supervisor workload" /><CardBody><BarList tone="indigo" rows={d.supervisorLoad.map((s) => ({ label: `${s.name} (cap ${s.capacity ?? '-'})`, value: s.projects }))} /></CardBody></Card>
        </div>
        <Card><CardHead title="Recent activity"><Link className="small" to="/coordinator/audit">Audit log</Link></CardHead><CardBody>
          {!d.recentActivity.length ? <p className="muted small" style={{ margin: 0 }}>No activity recorded yet.</p> : <ul className="list">{d.recentActivity.map((r) => <li key={r._id}><div>{r.summary}</div><div className="muted small">{r.actor?.name || 'System'} {r.actor?.role && <StatusBadge status={r.actor.role} />} - {timeAgo(r.createdAt)}</div></li>)}</ul>}
        </CardBody></Card>
      </div>
    </>
  );
}
