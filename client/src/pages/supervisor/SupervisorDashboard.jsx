import { CalendarDays, ClipboardCheck, FileText, FolderKanban, MessageSquare, AlertTriangle, Clock } from 'lucide-react';
import NextSteps from '../../components/common/NextSteps.jsx';
import { Badge, Button, Card, CardBody, CardHead, ErrorState, Loading, PageHeader, ProgressBar, StatCard, StatusBadge, EmptyState } from '../../components/common/ui.jsx';
import { Link } from 'react-router-dom';
import { useAsync } from '../../hooks/useAsync.js';
import { get } from '../../services/api.js';
import { fmtDate, fmtDateTime, timeAgo } from '../../utils/format.js';
import Hint from '../../components/onboarding/Hint.jsx';

export default function SupervisorDashboard() {
  const state = useAsync(() => get('/dashboard/supervisor'), []);
  if (state.loading && !state.data) return <Loading />;
  if (state.error && !state.data) return <ErrorState message={state.error} onRetry={state.reload} />;
  const d = state.data;
  const c = d.counts;
  const todo = [
    c.pendingProposals > 0 && { text: `Review ${c.pendingProposals} proposal${c.pendingProposals === 1 ? '' : 's'}`, hint: 'Groups are waiting for your decision.', to: '/supervisor/proposals' },
    c.reportsToReview > 0 && { text: `Review ${c.reportsToReview} progress report${c.reportsToReview === 1 ? '' : 's'}`, hint: c.lateReports ? `${c.lateReports} were submitted late.` : undefined, to: '/supervisor/reports' },
    c.finalReportsToReview > 0 && { text: `Review ${c.finalReportsToReview} final report${c.finalReportsToReview === 1 ? '' : 's'}`, to: '/supervisor/final-reports' },
    c.overdueSubmissions > 0 && { text: `${c.overdueSubmissions} overdue submission${c.overdueSubmissions === 1 ? '' : 's'}`, hint: 'Remind the groups or chat with them.', to: '/supervisor/monitoring' },
    c.assignedProjects === 0 && { text: 'Wait for projects to be assigned', hint: 'The coordinator assigns groups to you.' },
  ].filter(Boolean);
  return (
    <>
      <PageHeader title="Supervisor dashboard" subtitle="What needs your attention today." />
      <Hint id="supervisor.dashboard" />
      <NextSteps title="Your to-do list" steps={todo} emptyText="Nothing is waiting for you. Well done!" />
      <div className="grid cols-3 mb" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))' }}>
        <StatCard icon={FolderKanban} label="Assigned projects" value={c.assignedProjects} to="/supervisor/projects" />
        <StatCard icon={ClipboardCheck} label="Pending proposals" value={c.pendingProposals} tone={c.pendingProposals ? 'warning' : undefined} to="/supervisor/proposals" />
        <StatCard icon={FileText} label="Reports to review" value={c.reportsToReview} tone={c.reportsToReview ? 'warning' : undefined} hint={`${c.lateReports} submitted late`} to="/supervisor/reports" />
        <StatCard icon={FileText} label="Final reports" value={c.finalReportsToReview} to="/supervisor/final-reports" />
        <StatCard icon={AlertTriangle} label="Overdue submissions" value={c.overdueSubmissions} tone={c.overdueSubmissions ? 'danger' : 'success'} to="/supervisor/monitoring" />
      </div>
      <div className="grid cols-2" style={{ alignItems: 'start' }}>
        <Card><CardHead title="Project progress" icon={FolderKanban} />{!d.projects.length ? <EmptyState title="No projects assigned yet">The coordinator assigns groups to you.</EmptyState> : (
          <ul className="list" style={{ padding: '0 var(--sp-5)' }}>{d.projects.map((p) => (
            <li key={p._id}><div className="row between"><Link to={`/supervisor/projects/${p._id}`}><strong>{p.group?.name}</strong></Link><span className="row"><StatusBadge status={p.status} />{p.overdue > 0 && <Badge tone="danger">{p.overdue} overdue</Badge>}</span></div>
              <div className="muted small truncate">{p.title}</div><ProgressBar value={p.progress} tone={p.overdue ? 'danger' : undefined} /></li>))}</ul>)}</Card>
        <div className="stack">
          <Card><CardHead title="Oldest waiting reports" icon={Clock}><Link className="small" to="/supervisor/reports">Open queue</Link></CardHead><CardBody>
            {!d.oldestPending.length ? <p className="muted small" style={{ margin: 0 }}>Nothing is waiting for review.</p> : <ul className="list">{d.oldestPending.map((r) => <li key={r._id} className="row between"><span><Link to={`/supervisor/reports/${r._id}`}><strong>{r.title}</strong></Link><div className="muted small">{r.group} - {timeAgo(r.submittedAt)}</div></span>{r.isLate && <Badge tone="danger">Late</Badge>}</li>)}</ul>}</CardBody></Card>
          <Card><CardHead title="Upcoming deadlines" icon={CalendarDays} /><CardBody>
            {!d.upcomingDeadlines.length ? <p className="muted small" style={{ margin: 0 }}>No milestones due in the next 14 days.</p> : <ul className="list">{d.upcomingDeadlines.map((m) => <li key={m._id} className="row between"><span><strong>{m.title}</strong><div className="muted small">{m.group}</div></span><span>{fmtDate(m.plannedDate)}</span></li>)}</ul>}</CardBody></Card>
          <Card><CardHead title="Upcoming meetings" icon={CalendarDays}><Link className="small" to="/supervisor/meetings">All meetings</Link></CardHead><CardBody>
            {!d.upcomingMeetings.length ? <p className="muted small" style={{ margin: 0 }}>No meetings scheduled.</p> : <ul className="list">{d.upcomingMeetings.map((m) => <li key={m._id}><strong>{m.title}</strong><div className="muted small">{m.project?.group?.name} - {fmtDateTime(m.scheduledAt)}</div></li>)}</ul>}</CardBody></Card>
          <Card><CardHead title="Recent feedback activity" icon={MessageSquare}><Link className="small" to="/supervisor/feedback">Open</Link></CardHead><CardBody>
            {!d.recentFeedback.length ? <p className="muted small" style={{ margin: 0 }}>No recent activity.</p> : <ul className="list">{d.recentFeedback.map((f) => <li key={f._id}><strong>{f.author?.name}</strong> <span className="muted small">in {f.thread} - {timeAgo(f.createdAt)}</span><div className="small">{f.body}</div></li>)}</ul>}</CardBody></Card>
        </div>
      </div>
    </>
  );
}
