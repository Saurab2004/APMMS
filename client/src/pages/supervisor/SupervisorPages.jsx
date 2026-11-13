import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Activity, Award, FolderKanban, AlertTriangle } from 'lucide-react';
import { Alert, Badge, Button, Card, CardBody, EmptyState, ErrorState, Loading, PageHeader, ProgressBar, StatusBadge } from '../../components/common/ui.jsx';
import DataTable from '../../components/tables/DataTable.jsx';
import { SearchInput, Select } from '../../components/forms/fields.jsx';
import { usePaged } from '../../hooks/usePaged.js';
import { useAsync } from '../../hooks/useAsync.js';
import { get } from '../../services/api.js';
import { PROJECT_STATUSES } from '../../utils/constants.js';
import { titleCase } from '../../utils/format.js';
import Hint from '../../components/onboarding/Hint.jsx';

export function AssignedProjectsPage() {
  const list = usePaged('/projects', { limit: 12 });
  const columns = [
    { key: 'title', header: 'Project', render: (p) => <div><strong>{p.title}</strong><div className="sub">{p.group?.name}</div></div> },
    { key: 'status', header: 'Status', render: (p) => <StatusBadge status={p.status} /> },
    { key: 'proposal', header: 'Proposal', render: (p) => p.proposalStatus ? <StatusBadge status={p.proposalStatus} /> : <span className="muted">-</span> },
    { key: 'progress', header: 'Progress', render: (p) => <div style={{ minWidth: 120 }}><ProgressBar value={p.progress} tone={p.overdueMilestones ? 'danger' : undefined} /><span className="sub">{p.progress}%{p.overdueMilestones ? ` - ${p.overdueMilestones} overdue` : ''}</span></div> },
    { key: 'a', header: '', className: 'actions', render: (p) => <Button size="sm" variant="secondary" to={`/supervisor/projects/${p._id}`}>Open</Button> },
  ];
  return (<><PageHeader title="Assigned projects" subtitle="Groups you supervise." />
    <div className="filters"><SearchInput value={list.q} onChange={list.setQ} placeholder="Search project or group" />
      <Select aria-label="Status" value={list.filters.status || ''} onChange={(e) => list.setFilter('status', e.target.value)}><option value="">All statuses</option>{PROJECT_STATUSES.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}</Select></div>
    <DataTable columns={columns} rows={list.rows} loading={list.loading} error={list.error} onRetry={list.reload} meta={list.meta} onPage={list.setPage} minWidth={700} empty={<EmptyState icon={FolderKanban} title="No projects assigned yet" />} /></>);
}

export function ProgressMonitoringPage() {
  const state = useAsync(() => get('/milestones/progress-overview'), []);
  if (state.loading && !state.data) return <Loading />;
  if (state.error && !state.data) return <ErrorState message={state.error} onRetry={state.reload} />;
  const columns = [
    { key: 'group', header: 'Group', render: (p) => <div><strong>{p.group?.name}</strong><div className="sub">{p.title}</div></div> },
    { key: 'status', header: 'Status', render: (p) => <StatusBadge status={p.status} /> },
    { key: 'progress', header: 'Progress', render: (p) => <div style={{ minWidth: 120 }}><ProgressBar value={p.progress} /><span className="sub">{p.completedMilestones}/{p.milestones} milestones</span></div> },
    { key: 'overdue', header: 'Overdue', render: (p) => p.overdueMilestones ? <Badge tone="danger">{p.overdueMilestones}</Badge> : <span className="muted">0</span> },
    { key: 'missing', header: 'Missing reports', render: (p) => p.missingReports ? <Badge tone="danger"><AlertTriangle size={12} />{p.missingReports}</Badge> : <span className="muted">0</span> },
    { key: 'await', header: 'Awaiting review', render: (p) => p.awaitingReview ? <Badge tone="warning">{p.awaitingReview}</Badge> : <span className="muted">0</span> },
    { key: 'late', header: 'Late reports', render: (p) => p.lateReports || 0 },
    { key: 'a', header: '', className: 'actions', render: (p) => <Button size="sm" variant="secondary" to={`/supervisor/projects/${p._id}`}>Open</Button> },
  ];
  return (<><PageHeader title="Progress monitoring" subtitle="Late or missing submissions and overdue milestones across your groups." />
    <DataTable columns={columns} rows={state.data} minWidth={820} empty={<EmptyState icon={Activity} title="Nothing to monitor yet" />} /></>);
}

export function EvaluationListPage() {
  const state = useAsync(() => get('/evaluations/mine'), []);
  if (state.loading && !state.data) return <Loading />;
  if (state.error && !state.data) return <ErrorState message={state.error} onRetry={state.reload} />;
  return (
    <>
      <PageHeader title="Evaluation" subtitle="Score your groups against the coordinator's rubrics. Submitted evaluations are final and are not shown to students until the coordinator publishes results." />
      <Hint id="supervisor.evaluation" />
      {!state.data.length ? <Card><EmptyState icon={Award} title="No projects ready for evaluation">Projects appear here once they are far enough along.</EmptyState></Card> : (
        <div className="stack">{state.data.map((it) => (
          <Card key={it.project._id}><CardBody className="stack-sm">
            <div className="row between"><div><h3>{it.project.group?.name}</h3><div className="muted small">{it.project.title}</div></div><StatusBadge status={it.project.status} /></div>
            {it.rubrics.map((r) => (
              <div key={r.rubric._id} className="row between" style={{ borderTop: '1px solid var(--border)', paddingTop: 8 }}>
                <span>{r.rubric.name} <span className="muted small">- {r.rubric.stage}</span></span>
                <span className="row">{r.evaluation ? <><StatusBadge status={r.evaluation.status === 'submitted' ? 'completed' : 'draft'} label={r.evaluation.status === 'submitted' ? 'Submitted' : 'Draft'} /><span className="small">{r.evaluation.total}/{r.evaluation.maxTotal}</span></> : <Badge>Not started</Badge>}
                  <Button size="sm" variant={r.evaluation?.status === 'submitted' ? 'secondary' : 'primary'} to={`/supervisor/evaluation/${it.project._id}/${r.rubric._id}`}>{r.evaluation?.status === 'submitted' ? 'View' : 'Evaluate'}</Button></span>
              </div>))}
          </CardBody></Card>))}</div>)}
    </>
  );
}
