import { AlertTriangle, CalendarDays, FileText, Flag, Mail, MessageSquare, UsersRound } from 'lucide-react';
import NextSteps from '../../components/common/NextSteps.jsx';
import { Alert, Badge, Button, Card, CardBody, CardHead, EmptyState, ErrorState, Loading, PageHeader, ProgressBar, StatCard, StatusBadge } from '../../components/common/ui.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { get } from '../../services/api.js';
import { fmtDate, fmtDateTime, timeAgo } from '../../utils/format.js';
import Hint from '../../components/onboarding/Hint.jsx';

export default function StudentDashboard() {
  const { user } = useAuth();
  const state = useAsync(() => get('/dashboard/student'), []);
  if (state.loading && !state.data) return <Loading />;
  if (state.error && !state.data) return <ErrorState message={state.error} onRetry={state.reload} />;
  const d = state.data;

  if (!d.hasGroup) return (
    <>
      <PageHeader title={`Welcome, ${user.name.split(' ')[0]}`} subtitle="Start by creating or joining a project group." />
      <Hint id="student.dashboard" />
      {d.invitations > 0 && <Alert tone="info" className="mb">You have {d.invitations} pending group invitation(s). <a href="/student/invitations">Review invitations</a></Alert>}
      <Card><EmptyState icon={UsersRound} title="You are not in a group yet" action={<div className="row" style={{ justifyContent: 'center' }}><Button to="/student/group/create">Create a group</Button><Button variant="secondary" to="/student/group/join">Join with a code</Button></div>}>
        Groups work on one project together. The Group Leader submits official proposals and reports.</EmptyState></Card>
    </>
  );


  const st = d.proposal?.status || 'draft';
  const proj = d.project.status;
  const finalStage = ['ready_for_evaluation', 'evaluated', 'completed'].includes(proj);
  const steps = [
    { text: 'Create or join a group', done: true },
    { text: 'Get a supervisor', hint: d.project.supervisor ? `Assigned: ${d.project.supervisor.name}` : 'The coordinator assigns one. You will be notified.', done: !!d.project.supervisor },
    { text: st === 'revision_required' ? 'Revise your proposal' : ['submitted', 'under_review'].includes(st) ? 'Proposal is being reviewed' : 'Submit your proposal', hint: st === 'approved' ? 'Approved by your supervisor.' : st === 'revision_required' ? 'Your supervisor asked for changes.' : ['submitted', 'under_review'].includes(st) ? 'Nothing to do now. You will be notified.' : d.myRole === 'leader' ? 'Run the similar-project check first.' : 'Only the Group Leader can submit.', done: st === 'approved', to: ['submitted', 'under_review'].includes(st) ? '/student/proposal/status' : '/student/proposal' },
    { text: 'Send progress reports', hint: `${d.reportCounts.approved} approved so far${d.reportCounts.revisionRequired ? `, ${d.reportCounts.revisionRequired} need changes` : ''}`, done: d.reportCounts.approved > 0 && !d.reportCounts.revisionRequired, to: d.reportCounts.revisionRequired ? '/student/reports' : '/student/reports/new' },
    { text: 'Submit the final report', hint: 'Opens after enough progress reports are approved.', done: finalStage, to: '/student/final-report' },
  ];
  return (
    <>
      <PageHeader title={`Welcome, ${user.name.split(' ')[0]}`} subtitle={`${d.group.name} - ${d.project.title}`} actions={<Badge tone={d.myRole === 'leader' ? 'indigo' : 'neutral'}>{d.myRole === 'leader' ? 'Group Leader' : 'Member'}</Badge>} />
      <Hint id="student.dashboard" />
      {d.reportCounts.revisionRequired > 0 && <Alert tone="warning" className="mb">{d.reportCounts.revisionRequired} report(s) need revisions. <a href="/student/reports">Open reports</a></Alert>}
      {d.proposal?.status === 'revision_required' && <Alert tone="warning" className="mb">Your proposal needs revisions. <a href="/student/proposal">Edit proposal</a></Alert>}
      <NextSteps steps={steps} />
      <div className="grid cols-4 mb">
        <StatCard label="Project status" value={<StatusBadge status={d.project.status} />} hint={d.project.supervisor ? `Supervisor: ${d.project.supervisor.name}` : 'No supervisor assigned yet'} />
        <StatCard label="Proposal" value={<StatusBadge status={d.proposal?.status || 'draft'} />} hint={d.deadlines.proposal ? `Deadline ${fmtDate(d.deadlines.proposal)}` : undefined} to="/student/proposal/status" />
        <StatCard icon={FileText} label="Reports" value={d.reportCounts.total} hint={`${d.reportCounts.approved} approved - ${d.reportCounts.awaitingReview} awaiting review`} to="/student/reports" />
        <StatCard icon={Flag} label="Overdue milestones" value={d.overdueMilestones} tone={d.overdueMilestones ? 'danger' : 'success'} hint="Open the project for details" to="/student/project" />
      </div>
      <div className="grid cols-2" style={{ alignItems: 'start' }}>
        <Card><CardHead title="Milestones" icon={Flag}><span className="muted small">{d.progress}% complete</span></CardHead><CardBody className="stack">
          <ProgressBar value={d.progress} />
          {!d.milestones.length ? <p className="muted small" style={{ margin: 0 }}>Your supervisor has not added milestones yet.</p> : (
            <ul className="list">{d.milestones.slice(0, 6).map((m) => <li key={m._id} className="row between"><span><strong>{m.title}</strong><div className="muted small">Due {fmtDate(m.plannedDate)}</div></span><span className="row">{m.overdue && <Badge tone="danger">Overdue</Badge>}<StatusBadge status={m.status} /></span></li>)}</ul>)}
        </CardBody></Card>
        <div className="stack">
          <Card><CardHead title="Upcoming meetings" icon={CalendarDays} />
            <CardBody>{!d.upcomingMeetings.length ? <p className="muted small" style={{ margin: 0 }}>No meetings scheduled.</p> : <ul className="list">{d.upcomingMeetings.map((m) => <li key={m._id}><strong>{m.title}</strong><div className="muted small">{fmtDateTime(m.scheduledAt)}{m.location ? ` - ${m.location}` : ''}</div></li>)}</ul>}</CardBody></Card>
          <Card><CardHead title="Recent feedback" icon={MessageSquare}><a className="small" href="/student/feedback">All feedback</a></CardHead>
            <CardBody>{!d.recentFeedback.length ? <p className="muted small" style={{ margin: 0 }}>No feedback yet.</p> : <ul className="list">{d.recentFeedback.map((f) => <li key={f._id}><div className="row"><strong>{f.author?.name}</strong>{f.isFormal && <Badge tone="indigo">Formal</Badge>}{f.decision && <StatusBadge status={f.decision} />}<span className="muted small">{timeAgo(f.createdAt)}</span></div><div className="small">{f.body}</div></li>)}</ul>}</CardBody></Card>
          {d.deadlines.finalReport && <Alert tone="info">Final report deadline: <strong>{fmtDate(d.deadlines.finalReport)}</strong></Alert>}
        </div>
      </div>
    </>
  );
}
