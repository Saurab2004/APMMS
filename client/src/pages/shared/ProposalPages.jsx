import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Check, ClipboardCheck, Download, PlayCircle, RotateCcw, Save, Send, X, Trash2 } from 'lucide-react';
import SimilarProjects from '../../components/projects/SimilarProjects.jsx';
import { Alert, Badge, Button, Card, CardBody, CardHead, EmptyState, ErrorState, KV, Loading, PageHeader, StatusBadge } from '../../components/common/ui.jsx';
import DataTable from '../../components/tables/DataTable.jsx';
import { ConfirmDialog } from '../../components/common/Modal.jsx';
import { Field, FileInput, Input, SearchInput, Select, TextArea } from '../../components/forms/fields.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { useForm } from '../../hooks/useForm.js';
import { usePaged } from '../../hooks/usePaged.js';
import { useMyProject } from '../../hooks/useProjects.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { api, del, downloadFile, errMsg, get, post, put } from '../../services/api.js';
import { fmtDate, fmtDateTime, titleCase } from '../../utils/format.js';
import Hint from '../../components/onboarding/Hint.jsx';

const FIELDS = [
  ['abstract', 'Abstract', 30], ['problemStatement', 'Problem statement', 30], ['objectives', 'Objectives', 20],
  ['methodology', 'Methodology', 20], ['expectedOutcomes', 'Expected outcomes', 10],
];

function VersionContent({ v, projectId }) {
  const toast = useToast();
  return (
    <div className="stack">
      <h3>{v.title}</h3>
      {FIELDS.map(([k, label]) => v[k] ? <div key={k}><div className="label small muted">{label}</div><div className="pre-wrap">{v[k]}</div></div> : null)}
      {v.technologyStack?.length > 0 && <div><div className="label small muted">Technology stack</div><div className="row" style={{ gap: 6 }}>{v.technologyStack.map((t) => <Badge key={t} tone="info">{t}</Badge>)}</div></div>}
      {v.attachments?.length > 0 && <div className="stack-sm"><div className="label small muted">Supporting documents</div>
        {v.attachments.map((a, i) => <div key={i} className="file-chip"><span className="name">{a.originalName}</span>
          <Button variant="secondary" size="sm" icon={Download} onClick={() => downloadFile(`/proposals/project/${projectId}/versions/${v.version}/attachments/${i}`, a.originalName).catch((e) => toast.error(errMsg(e)))}>Download</Button></div>)}</div>}
    </div>
  );
}

function History({ versions, projectId }) {
  if (!versions.length) return <p className="muted small" style={{ margin: 0 }}>No versions yet.</p>;
  return (
    <ul className="timeline">
      {versions.map((v) => (
        <li key={v.version} className={v.review?.decision === 'approved' ? 'done' : v.review?.decision === 'rejected' ? 'late' : ''}>
          <div className="row"><strong>Version {v.version}</strong>{v.state === 'draft' ? <Badge>Draft</Badge> : v.review?.decision ? <StatusBadge status={v.review.decision} /> : <StatusBadge status="submitted" />}</div>
          <div className="muted small">{v.submittedAt ? `Submitted ${fmtDateTime(v.submittedAt)} by ${v.submittedBy?.name || '-'}` : `Edited ${fmtDateTime(v.updatedAt)}`}</div>
          {v.review?.decision && <div className="mt" style={{ marginTop: 6 }}><span className="small muted">{v.review.reviewer?.name} - {fmtDateTime(v.review.reviewedAt)}</span><div className="pre-wrap">{v.review.comments || 'Approved.'}</div></div>}
          <details className="mt" style={{ marginTop: 6 }}><summary className="small" style={{ cursor: 'pointer', color: 'var(--primary)' }}>View content</summary><div className="mt"><VersionContent v={v} projectId={projectId} /></div></details>
        </li>
      ))}
    </ul>
  );
}

// ------------------------------------------------------------------ Student: write & submit
export function ProposalFormPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const mine = useMyProject();
  const projectId = mine.data?.projectId;
  const prop = useAsync(() => (projectId ? get(`/proposals/project/${projectId}`) : Promise.resolve(null)), [projectId]);
  const f = useForm({ title: '', abstract: '', problemStatement: '', objectives: '', methodology: '', expectedOutcomes: '', technologyStack: '' });
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState('');
  const [confirm, setConfirm] = useState(false);

  const data = prop.data;
  const draft = useMemo(() => data?.versions?.find((v) => v.state === 'draft') || data?.versions?.[0], [data]);
  useEffect(() => {
    if (draft) f.setValues({ title: draft.title || '', abstract: draft.abstract || '', problemStatement: draft.problemStatement || '', objectives: draft.objectives || '', methodology: draft.methodology || '', expectedOutcomes: draft.expectedOutcomes || '', technologyStack: (draft.technologyStack || []).join(', ') });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft?._id, draft?.version]);

  if (mine.loading || prop.loading) return <Loading />;
  if (!projectId) return <Card><EmptyState title="Create or join a group first">A proposal belongs to your project group.</EmptyState></Card>;
  const leader = mine.data.detail.access === 'leader';
  const canEdit = data?.canEdit ?? leader;
  const status = data?.proposal?.status || 'draft';
  const body = () => ({ ...f.values, technologyStack: f.values.technologyStack.split(',').map((s) => s.trim()).filter(Boolean) });

  const save = async () => {
    setBusy('save');
    try {
      await put(`/proposals/project/${projectId}/draft`, body());
      if (files.length) { const fd = new FormData(); files.forEach((x) => fd.append('attachments', x)); await api.post(`/proposals/project/${projectId}/attachments`, fd); setFiles([]); }
      toast.success('Draft saved'); await prop.reload(); return true;
    } catch (e) { f.applyError(e); toast.error(errMsg(e)); return false; } finally { setBusy(''); }
  };
  const submit = async () => {
    setConfirm(false);
    if (!(await save())) return;
    setBusy('submit');
    try { await post(`/proposals/project/${projectId}/submit`); toast.success('Proposal submitted for review'); navigate('/student/proposal/status'); } catch (e) { f.applyError(e); toast.error(errMsg(e)); } finally { setBusy(''); }
  };
  const removeAtt = async (i) => { try { await del(`/proposals/project/${projectId}/attachments/${i}`); prop.reload(); } catch (e) { toast.error(errMsg(e)); } };

  return (
    <>
      <PageHeader title="Proposal submission" subtitle="Describe your project. Save drafts as often as you like; submit when it is ready." actions={<Button variant="secondary" to="/student/proposal/status">Status and history</Button>} />
      <Hint id="student.proposal" />
      {!leader && <Alert tone="warning" className="mb">Only the Group Leader can edit and submit the official proposal. You can read it here.</Alert>}
      {leader && !canEdit && <Alert tone="info" className="mb">Your proposal is <strong>{titleCase(status)}</strong> and cannot be edited right now. <a href="/student/proposal/status">View status</a>.</Alert>}
      {status === 'revision_required' && <Alert tone="warning" className="mb">Your supervisor requested changes. Edit and resubmit - a new version will be created and the old one is kept.</Alert>}
      <Card><CardBody>
        <form className="stack" onSubmit={(e) => { e.preventDefault(); setConfirm(true); }}>
          <fieldset disabled={!canEdit || !leader} style={{ border: 0, padding: 0, margin: 0 }} className="stack">
            <Field label="Project title" required error={f.errors.title}><Input {...f.bind('title')} maxLength={200} /></Field>
            {FIELDS.map(([k, label, min]) => <Field key={k} label={label} required error={f.errors[k]} help={`${(f.values[k] || '').length} characters (minimum ${min})`}><TextArea {...f.bind(k)} rows={k === 'abstract' || k === 'problemStatement' ? 6 : 4} maxLength={4000} /></Field>)}
            <Field label="Proposed technology stack" required error={f.errors.technologyStack} help="Separate technologies with commas, e.g. React, Node.js, MongoDB"><Input {...f.bind('technologyStack')} /></Field>
            {draft?.state === 'draft' && draft.attachments?.length > 0 && <div className="stack-sm"><span className="label">Attached documents</span>
              {draft.attachments.map((a, i) => <div className="file-chip" key={i}><span className="name">{a.originalName}</span><Button variant="ghost" size="sm" icon={Trash2} aria-label={`Remove ${a.originalName}`} onClick={() => removeAtt(i)} /></div>)}</div>}
            <FileInput label="Add supporting documents (optional, max 5)" multiple accept={['pdf', 'docx', 'pptx', 'xlsx', 'zip', 'png', 'jpg', 'txt']} files={files} onChange={setFiles} />
          </fieldset>
          {canEdit && leader && <div className="row"><Button variant="secondary" icon={Save} loading={busy === 'save'} onClick={save}>Save draft</Button><Button type="submit" icon={Send} loading={busy === 'submit'}>Submit for review</Button></div>}
        </form>
      </CardBody></Card>
      {canEdit && leader && <Card className="mt"><CardHead title="Is your idea original?" /><CardBody><SimilarProjects projectId={projectId} /></CardBody></Card>}
      {confirm && <ConfirmDialog title="Submit proposal?" confirmLabel="Submit" onConfirm={submit} onClose={() => setConfirm(false)} message={<div className="stack"><p style={{ margin: 0 }}>Once submitted, the proposal is locked until your supervisor responds. Continue?</p><p className="muted small" style={{ margin: 0 }}>Your saved draft is compared with other projects:</p><SimilarProjects projectId={projectId} auto /></div>} />}
    </>
  );
}

// ------------------------------------------------------------------ Student: status & history
export function ProposalStatusPage() {
  const mine = useMyProject();
  const projectId = mine.data?.projectId;
  const prop = useAsync(() => (projectId ? get(`/proposals/project/${projectId}`) : Promise.resolve(null)), [projectId]);
  if (mine.loading) return <Loading />;
  if (!projectId) return <Card><EmptyState title="No project yet" /></Card>;
  if (prop.error && !prop.data) return <ErrorState message={prop.error} onRetry={prop.reload} />;
  if (!prop.data) return <Loading />;
  const { proposal, versions } = prop.data;
  return (
    <>
      <PageHeader title="Proposal status and history" actions={<Button to="/student/proposal" variant="secondary">{proposal?.status === 'revision_required' ? 'Revise proposal' : 'Open editor'}</Button>} />
      <Hint id="student.proposal" />
      {!proposal ? <Card><EmptyState title="No proposal yet">Start your proposal in the editor.</EmptyState></Card> : (
        <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,2fr)', alignItems: 'start' }}>
          <Card><CardHead title="Current status" /><CardBody className="stack">
            <div><StatusBadge status={proposal.status} /></div>
            <KV items={[['Current version', proposal.currentVersion], ['Approved version', proposal.approvedVersion], ['Last submitted', fmtDateTime(proposal.submittedAt)], ['Decision date', fmtDateTime(proposal.decidedAt)]]} />
            {proposal.status === 'approved' && <Alert tone="success">Approved. You can now submit progress reports.</Alert>}
            {proposal.status === 'revision_required' && <Alert tone="warning">Changes requested - see the comments in the history.</Alert>}
          </CardBody></Card>
          <Card><CardHead title="Version history" /><CardBody><History versions={versions} projectId={projectId} /></CardBody></Card>
        </div>
      )}
      <style>{`@media (max-width: 960px) { .grid[style*='1fr) minmax(0,2fr'] { grid-template-columns: minmax(0,1fr) !important; } }`}</style>
    </>
  );
}

// ------------------------------------------------------------------ Staff: queue
export function ProposalsListPage({ base, title = 'Proposals', pendingDefault }) {
  const { user } = useAuth();
  const isCoord = user.role === 'coordinator';
  const list = usePaged('/proposals', { limit: 12, initialFilters: { pending: pendingDefault ? '1' : '' } });
  const deps = useAsync(() => (isCoord ? get('/departments') : Promise.resolve([])), []);
  const columns = [
    { key: 'title', header: 'Project', render: (p) => <div><strong>{p.project?.title}</strong><div className="sub">{p.project?.group?.name} - v{p.currentVersion}</div></div> },
    ...(isCoord ? [{ key: 'dept', header: 'Department', render: (p) => p.project?.department?.code }, { key: 'sup', header: 'Supervisor', render: (p) => p.project?.supervisor?.name || <span className="muted">Unassigned</span> }] : []),
    { key: 'status', header: 'Status', render: (p) => <StatusBadge status={p.status} /> },
    { key: 'submittedAt', header: 'Submitted', render: (p) => fmtDate(p.submittedAt) },
    { key: 'a', header: '', className: 'actions', render: (p) => <Button size="sm" variant="secondary" to={`${base}/${p._id}`}>{['submitted', 'under_review'].includes(p.status) ? 'Review' : 'View'}</Button> },
  ];
  return (
    <>
      <PageHeader title={title} subtitle={isCoord ? 'Proposals across all projects and departments.' : 'Proposals from your assigned groups.'} />
      {user.role === 'supervisor' && <Hint id="supervisor.proposals" />}
      <div className="filters">
        <SearchInput value={list.q} onChange={list.setQ} placeholder="Search project title" />
        <Select aria-label="Status" value={list.filters.pending ? 'pending' : list.filters.status || ''} onChange={(e) => { const v = e.target.value; list.setFilter('pending', v === 'pending' ? '1' : ''); list.setFilter('status', v === 'pending' ? '' : v); }}>
          <option value="">All statuses</option><option value="pending">Awaiting review</option>{['draft', 'revision_required', 'approved', 'rejected'].map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
        </Select>
        {isCoord && <Select aria-label="Department" value={list.filters.department || ''} onChange={(e) => list.setFilter('department', e.target.value)}><option value="">All departments</option>{(deps.data || []).map((d) => <option key={d._id} value={d._id}>{d.name}</option>)}</Select>}
      </div>
      <DataTable columns={columns} rows={list.rows} loading={list.loading} error={list.error} onRetry={list.reload} meta={list.meta} onPage={list.setPage} minWidth={680}
        empty={<EmptyState icon={ClipboardCheck} title="No proposals found">Submitted proposals will appear here.</EmptyState>} />
    </>
  );
}

// ------------------------------------------------------------------ Staff: review
export function ProposalReviewPage({ backTo }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const state = useAsync(() => get(`/proposals/${id}`), [id]);
  const [comments, setComments] = useState('');
  const [confirm, setConfirm] = useState(null);
  const [busy, setBusy] = useState(false);
  if (state.loading && !state.data) return <Loading />;
  if (state.error && !state.data) return <ErrorState message={state.error} onRetry={state.reload} />;
  const { proposal, versions, project, group } = state.data;
  const latest = versions.find((v) => v.state === 'submitted');
  const reviewable = ['submitted', 'under_review'].includes(proposal.status);
  const needText = !comments.trim();

  const start = async () => { try { await post(`/proposals/${id}/start-review`); state.reload(); } catch (e) { toast.error(errMsg(e)); } };
  const decide = async () => {
    setBusy(true);
    try { await post(`/proposals/${id}/review`, { decision: confirm, comments }); toast.success('Decision recorded and the group leader was notified'); setConfirm(null); setComments(''); state.reload(); } catch (e) { toast.error(errMsg(e)); setConfirm(null); } finally { setBusy(false); }
  };
  return (
    <>
      <PageHeader title={latest?.title || project.title} subtitle={`${group.name} - ${project.department?.name || ''}`} actions={<Button variant="secondary" icon={ArrowLeft} onClick={() => navigate(backTo || -1)}>Back</Button>} />
      <div className="row mb"><StatusBadge status={proposal.status} /><Badge>Version {proposal.currentVersion}</Badge>{project.supervisor && <Badge tone="indigo">Supervisor: {project.supervisor.name}</Badge>}</div>
      <div className="grid" style={{ gridTemplateColumns: 'minmax(0,2fr) minmax(0,1fr)', alignItems: 'start' }}>
        <div className="stack" style={{ minWidth: 0 }}>
          {reviewable && (
            <Card><CardHead title="Review decision" /><CardBody className="stack">
              {proposal.status === 'submitted' && <div><Button variant="secondary" icon={PlayCircle} onClick={start}>Mark as under review</Button></div>}
              <Field label="Comments" help="Required when requesting revisions or rejecting."><TextArea value={comments} onChange={(e) => setComments(e.target.value)} rows={5} maxLength={4000} /></Field>
              <div className="row">
                <Button variant="success" icon={Check} onClick={() => setConfirm('approved')}>Approve</Button>
                <Button variant="secondary" icon={RotateCcw} disabled={needText} onClick={() => setConfirm('revision_required')}>Request revision</Button>
                <Button variant="danger" icon={X} disabled={needText} onClick={() => setConfirm('rejected')}>Reject</Button>
              </div>
            </CardBody></Card>
          )}
          <Card><CardHead title="Similar projects" /><CardBody><SimilarProjects projectId={project._id} auto /></CardBody></Card>
          <Card><CardHead title={`Submitted proposal${latest ? ` (v${latest.version})` : ''}`} /><CardBody>{latest ? <VersionContent v={latest} projectId={project._id} /> : <p className="muted">Nothing submitted yet.</p>}</CardBody></Card>
        </div>
        <Card><CardHead title="History" /><CardBody><History versions={versions} projectId={project._id} /></CardBody></Card>
      </div>
      {confirm && <ConfirmDialog title="Confirm decision" confirmLabel="Record decision" danger={confirm === 'rejected'} loading={busy} onConfirm={decide} onClose={() => setConfirm(null)} message={`Record "${titleCase(confirm)}" for this proposal?`} />}
      <style>{`@media (max-width: 960px) { .grid[style*='2fr'] { grid-template-columns: minmax(0,1fr) !important; } }`}</style>
    </>
  );
}
