import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Pencil, UserCheck } from 'lucide-react';
import { Alert, Badge, Button, Card, CardBody, CardHead, EmptyState, ErrorState, KV, Loading, PageHeader, ProgressBar, StatCard, StatusBadge, Tabs } from '../../components/common/ui.jsx';
import { Modal } from '../../components/common/Modal.jsx';
import { Field, Input, Select, TextArea } from '../../components/forms/fields.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { useForm } from '../../hooks/useForm.js';
import { useMyProject } from '../../hooks/useProjects.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { errMsg, get, patch, put } from '../../services/api.js';
import { fmtDate, fmtDateTime, timeAgo, titleCase } from '../../utils/format.js';
import { PROJECT_STATUSES } from '../../utils/constants.js';

function EditProject({ project, onClose, onSaved }) {
  const toast = useToast();
  const f = useForm({ title: project.title || '', summary: project.summary || '', technologies: (project.technologies || []).join(', ') });
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true);
    try { await patch(`/projects/${project._id}`, { ...f.values, technologies: f.values.technologies.split(',').map((s) => s.trim()).filter(Boolean) }); toast.success('Project updated'); onSaved(); } catch (err) { f.applyError(err); toast.error(errMsg(err)); } finally { setBusy(false); }
  };
  return (
    <Modal title="Edit project details" onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="proj-form" loading={busy}>Save</Button></>}>
      <form id="proj-form" className="stack" onSubmit={submit}>
        <Field label="Title" required error={f.errors.title}><Input {...f.bind('title')} required /></Field>
        <Field label="Summary" error={f.errors.summary}><TextArea {...f.bind('summary')} rows={5} /></Field>
        <Field label="Technologies" help="Separate with commas"><Input {...f.bind('technologies')} /></Field>
      </form>
    </Modal>
  );
}

function AssignSupervisor({ project, onClose, onSaved }) {
  const toast = useToast();
  const sups = useAsync(() => get('/users/supervisors'), []);
  const [id, setId] = useState(project.supervisor?._id || '');
  const [busy, setBusy] = useState(false);
  const save = async (force) => {
    setBusy(true);
    try { await put(`/projects/${project._id}/supervisor`, { supervisorId: id, force }); toast.success('Supervisor assigned'); onSaved(); } catch (err) {
      if (err.status === 409 && !force && /capacity|workload|maximum/i.test(errMsg(err)) && window.confirm(`${errMsg(err)}\n\nAssign anyway?`)) return save(true);
      toast.error(errMsg(err));
    } finally { setBusy(false); }
  };
  return (
    <Modal title="Assign supervisor" onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} disabled={!id} onClick={() => save(false)}>Assign</Button></>}>
      <Field label="Supervisor"><Select value={id} onChange={(e) => setId(e.target.value)}><option value="">Select supervisor</option>
        {(sups.data || []).filter((s) => s.isActive).map((s) => <option key={s._id} value={s._id}>{s.name} ({s.workload ?? 0}/{s.maxProjects} projects)</option>)}</Select></Field>
      <p className="muted small mt">The previous supervisor (if any) is kept in the assignment history.</p>
    </Modal>
  );
}

/** Project overview used by students ("My project"), supervisors and the coordinator. */
export default function ProjectDetailPage({ mine, backTo, base }) {
  const params = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const toast = useToast();
  const myProj = useMyProject();
  const id = mine ? myProj.data?.projectId : params.id;
  const [tab, setTab] = useState('overview');
  const [modal, setModal] = useState('');
  const state = useAsync(() => (id ? get(`/projects/${id}`) : Promise.resolve(null)), [id]);
  const ms = useAsync(() => (id ? get('/milestones', { project: id, limit: 100 }) : Promise.resolve([])), [id]);
  const tl = useAsync(() => (id && tab === 'timeline' ? get(`/projects/${id}/timeline`, { limit: 50 }) : Promise.resolve(null)), [id, tab]);

  if (mine && myProj.loading) return <Loading />;
  if (mine && !id) return <Card><EmptyState title="You do not have a project yet">Create or join a group and your project is created automatically.</EmptyState></Card>;
  if (state.error && !state.data) return <ErrorState message={state.error} onRetry={state.reload} />;
  if (!state.data) return <Loading />;
  const { project, group, proposal, progress, overdueMilestones, reports, access } = state.data;
  const isLeader = access === 'leader';
  const isCoord = user.role === 'coordinator';
  const members = group.members.filter((m) => m.status === 'active');
  const count = (k, ...s) => s.reduce((n, st) => n + (reports[k]?.[st] || 0), 0);

  return (
    <>
      <PageHeader title={project.title} subtitle={`${group.name} - ${project.department?.name} - ${project.term?.name}`}
        actions={<>
          {!mine && <Button variant="secondary" icon={ArrowLeft} onClick={() => navigate(backTo || -1)}>Back</Button>}
          {(isLeader || isCoord) && <Button variant="secondary" icon={Pencil} onClick={() => setModal('edit')}>Edit details</Button>}
          {isCoord && <Button icon={UserCheck} onClick={() => setModal('assign')}>{project.supervisor ? 'Change supervisor' : 'Assign supervisor'}</Button>}
        </>} />
      <div className="grid cols-4 mb">
        <StatCard label="Status" value={<StatusBadge status={project.status} />} />
        <StatCard label="Progress" value={`${progress}%`} hint={`${overdueMilestones} overdue milestone(s)`} tone={overdueMilestones ? 'danger' : undefined} />
        <StatCard label="Proposal" value={<StatusBadge status={proposal?.status || 'draft'} />} hint={proposal ? `v${proposal.currentVersion}` : 'Not started'} />
        <StatCard label="Reports awaiting review" value={count('progress', 'submitted', 'resubmitted', 'under_review') + count('final', 'submitted', 'resubmitted', 'under_review')} hint={`${count('progress', 'approved')} progress report(s) approved`} />
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'overview', label: 'Overview' }, { key: 'milestones', label: 'Milestones', count: ms.data?.length }, { key: 'timeline', label: 'Activity timeline' }]} />

      {tab === 'overview' && (
        <div className="grid cols-2" style={{ alignItems: 'start' }}>
          <Card><CardHead title="About the project" /><CardBody className="stack">
            <ProgressBar value={progress} tone={overdueMilestones ? 'danger' : undefined} />
            <div className="pre-wrap">{project.summary || <span className="muted">No summary yet. {isLeader ? 'Add one with "Edit details".' : ''}</span>}</div>
            {project.technologies?.length > 0 && <div className="row" style={{ gap: 6 }}>{project.technologies.map((t) => <Badge key={t} tone="info">{t}</Badge>)}</div>}
          </CardBody></Card>
          <Card><CardHead title="Team and supervision" /><CardBody className="stack">
            <KV items={[['Supervisor', project.supervisor ? `${project.supervisor.name} (${project.supervisor.email})` : <Badge tone="warning">Not assigned</Badge>], ['Group code', isCoord || access !== 'supervisor' ? <code>{group.code}</code> : null]]} />
            <ul className="list">{members.map((m) => <li key={m.user._id} className="row between"><span>{m.user.name} <span className="muted small">{m.user.studentId}</span></span><StatusBadge status={m.role} /></li>)}</ul>
            {project.supervisorHistory?.length > 0 && <div><div className="label small muted">Supervisor history</div><ul className="list">{project.supervisorHistory.map((h, i) => <li key={i} className="small">{h.supervisor?.name} - from {fmtDate(h.assignedAt)}{h.unassignedAt ? ` to ${fmtDate(h.unassignedAt)}` : ' (current)'}</li>)}</ul></div>}
          </CardBody></Card>
          {isCoord && <Card><CardHead title="Lifecycle (coordinator)" /><CardBody className="stack"><Select value={project.status} aria-label="Project status" onChange={async (e) => { try { await patch(`/projects/${project._id}/status`, { status: e.target.value }); toast.success('Status updated'); state.reload(); } catch (err) { toast.error(errMsg(err)); } }}>{PROJECT_STATUSES.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}</Select><span className="muted small">Changing status is recorded in the audit log.</span></CardBody></Card>}
        </div>
      )}

      {tab === 'milestones' && (
        <Card>{!ms.data?.length ? <EmptyState title="No milestones yet" /> : <div className="table-wrap"><table className="table" style={{ minWidth: 560 }}><thead><tr><th>Milestone</th><th>Planned</th><th>Actual</th><th>Status</th><th>Progress</th></tr></thead>
          <tbody>{ms.data.map((m) => <tr key={m._id}><td><strong>{m.title}</strong>{m.remarks && <div className="sub">Supervisor: {m.remarks}</div>}</td><td>{fmtDate(m.plannedDate)} {m.overdue && <Badge tone="danger">Overdue</Badge>}</td><td>{fmtDate(m.actualDate)}</td><td><StatusBadge status={m.status} /></td><td style={{ minWidth: 120 }}><ProgressBar value={m.status === 'completed' ? 100 : m.progress} /></td></tr>)}</tbody></table></div>}</Card>
      )}

      {tab === 'timeline' && (
        <Card><CardBody>{tl.loading ? <Loading /> : !tl.data?.length ? <EmptyState title="No activity yet" /> : (
          <ul className="timeline">{tl.data.map((a) => <li key={a._id}><strong>{a.summary || a.action}</strong><div className="muted small">{a.actor?.name} ({a.actor?.role}) - {fmtDateTime(a.createdAt)} ({timeAgo(a.createdAt)})</div></li>)}</ul>)}</CardBody></Card>
      )}
      {modal === 'edit' && <EditProject project={project} onClose={() => setModal('')} onSaved={() => { setModal(''); state.reload(); }} />}
      {modal === 'assign' && <AssignSupervisor project={project} onClose={() => setModal('')} onSaved={() => { setModal(''); state.reload(); }} />}
    </>
  );
}
