import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Check, Download, RotateCcw, Send, Upload, X, PlayCircle } from 'lucide-react';
import { Alert, Badge, Button, Card, CardBody, CardHead, KV, Loading, ErrorState, PageHeader, StatusBadge } from '../../components/common/ui.jsx';
import { Field, FileInput, TextArea } from '../../components/forms/fields.jsx';
import { ConfirmDialog } from '../../components/common/Modal.jsx';
import DocumentPreview from '../../components/reports/DocumentPreview.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { useToast } from '../../context/ToastContext.jsx';
import { api, downloadFile, errMsg, get, post } from '../../services/api.js';
import { fmtDate, fmtDateTime, titleCase } from '../../utils/format.js';

function ReviewPanel({ report, onDone }) {
  const toast = useToast();
  const [comments, setComments] = useState('');
  const [confirm, setConfirm] = useState(null);
  const [busy, setBusy] = useState(false);

  const start = async () => { try { await post(`/reports/${report._id}/start-review`); onDone(); } catch (e) { toast.error(errMsg(e)); } };
  const decide = async () => {
    setBusy(true);
    try { await post(`/reports/${report._id}/review`, { decision: confirm, comments }); toast.success('Decision recorded and the group leader was notified'); setConfirm(null); setComments(''); onDone(); } catch (e) { toast.error(errMsg(e)); setConfirm(null); } finally { setBusy(false); }
  };
  const needText = (d) => d !== 'approved' && !comments.trim();
  return (
    <Card>
      <CardHead title="Review decision" />
      <CardBody className="stack">
        {report.status !== 'under_review' && <div><Button variant="secondary" icon={PlayCircle} onClick={start}>Mark as under review</Button></div>}
        <Field label="Comments and revision instructions" help="Required when requesting a revision or rejecting."><TextArea value={comments} onChange={(e) => setComments(e.target.value)} rows={5} maxLength={4000} /></Field>
        <div className="row">
          <Button variant="success" icon={Check} onClick={() => setConfirm('approved')}>Approve</Button>
          <Button variant="secondary" icon={RotateCcw} disabled={needText('rev')} onClick={() => setConfirm('revision_required')}>Request revision</Button>
          <Button variant="danger" icon={X} disabled={needText('rej')} onClick={() => setConfirm('rejected')}>Reject</Button>
        </div>
      </CardBody>
      {confirm && <ConfirmDialog title="Confirm decision" confirmLabel="Record decision" danger={confirm === 'rejected'} loading={busy} onConfirm={decide} onClose={() => setConfirm(null)}
        message={`Record "${titleCase(confirm)}" for "${report.title}"? ${confirm === 'approved' ? '' : 'The group leader will see your comments.'}`} />}
    </Card>
  );
}

function ResubmitPanel({ report, onDone }) {
  const toast = useToast();
  const [files, setFiles] = useState([]);
  const [extra, setExtra] = useState([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', files[0]); fd.append('note', note);
      extra.forEach((f) => fd.append('attachments', f));
      await api.post(`/reports/${report._id}/resubmit`, fd);
      toast.success('Corrected report resubmitted'); onDone();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Card>
      <CardHead title="Resubmit corrected report" />
      <CardBody className="stack">
        <Alert tone="warning">Your supervisor asked for changes. Upload the corrected document; earlier versions stay in the history.</Alert>
        <FileInput label="Corrected report (PDF or DOCX)" files={files} onChange={setFiles} />
        <FileInput label="Supporting attachments (optional)" multiple accept={['pdf', 'docx', 'pptx', 'xlsx', 'zip', 'png', 'jpg', 'txt']} files={extra} onChange={setExtra} />
        <Field label="What changed?"><TextArea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={2000} /></Field>
        <div><Button icon={Send} loading={busy} disabled={!files[0]} onClick={submit}>Resubmit</Button></div>
      </CardBody>
    </Card>
  );
}

function DraftPanel({ report, hasFile, onDone }) {
  const toast = useToast();
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const run = async (submit) => {
    setBusy(true);
    try {
      if (files[0]) { const fd = new FormData(); fd.append('file', files[0]); await api.patch(`/reports/${report._id}`, fd); }
      if (submit) await post(`/reports/${report._id}/submit`);
      toast.success(submit ? 'Report submitted' : 'Draft saved'); setFiles([]); onDone();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Card>
      <CardHead title="Draft - not yet submitted" />
      <CardBody className="stack">
        <FileInput label={hasFile ? 'Replace report file (optional)' : 'Report file (PDF or DOCX)'} files={files} onChange={setFiles} />
        <div className="row">
          <Button variant="secondary" loading={busy} disabled={!files[0]} onClick={() => run(false)}>Save draft</Button>
          <Button icon={Send} loading={busy} disabled={!hasFile && !files[0]} onClick={() => run(true)}>Submit to supervisor</Button>
        </div>
      </CardBody>
    </Card>
  );
}

export default function ReportDetailPage({ backTo }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const state = useAsync(() => get(`/reports/${id}`), [id]);
  const [ver, setVer] = useState(null);
  if (state.loading && !state.data) return <Loading />;
  if (state.error && !state.data) return <ErrorState message={state.error} onRetry={state.reload} />;
  const { report, versions, reviews, project, group, access, canReview, canResubmit, canEditDraft } = state.data;
  const staff = access === 'supervisor' || access === 'coordinator';
  const current = versions.find((v) => v.version === (ver ?? report.currentVersion)) || versions[0];
  const fileUrl = (v) => `/reports/${report._id}/versions/${v.version}/file`;

  return (
    <>
      <PageHeader title={report.title} subtitle={`${group.name} - ${project.title}`}
        actions={<Button variant="secondary" icon={ArrowLeft} onClick={() => navigate(backTo || -1)}>Back</Button>} />
      <div className="row mb">
        <StatusBadge status={report.status} />{report.isLate && <Badge tone="danger">Submitted late</Badge>}
        <Badge tone="indigo">{report.kind === 'final' ? 'Final report' : titleCase(report.type)}</Badge><Badge>Version {report.currentVersion}</Badge>
      </div>
      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)', alignItems: 'start' }}>
        <div className="stack" style={{ minWidth: 0 }}>
          {canReview && <ReviewPanel report={report} onDone={state.reload} />}
          {canEditDraft && <DraftPanel report={report} hasFile={Boolean(current?.file)} onDone={state.reload} />}
          {canResubmit && <ResubmitPanel report={report} onDone={state.reload} />}
          <Card>
            <CardHead title="Document">
              <select className="select" style={{ width: 'auto' }} aria-label="Version" value={current?.version} onChange={(e) => setVer(Number(e.target.value))}>
                {versions.map((v) => <option key={v.version} value={v.version}>Version {v.version}{v.state === 'draft' ? ' (draft)' : ''} - {fmtDate(v.submittedAt || v.createdAt)}</option>)}
              </select>
            </CardHead>
            <CardBody className="stack">
              {current?.file ? <DocumentPreview key={`${report._id}-${current.version}`} url={fileUrl(current)} file={current.file} /> : <Alert tone="info">No document uploaded yet.</Alert>}
              {current?.note && <Alert tone="info"><strong>Student note:</strong> {current.note}</Alert>}
              {current?.attachments?.length > 0 && (
                <div className="stack-sm"><strong className="small">Supporting attachments</strong>
                  {current.attachments.map((a, i) => (
                    <div className="file-chip" key={i}><span className="name">{a.originalName}</span>
                      <Button variant="secondary" size="sm" icon={Download} onClick={() => downloadFile(`/reports/${report._id}/versions/${current.version}/attachments/${i}`, a.originalName).catch((e) => toast.error(errMsg(e)))}>Download</Button></div>
                  ))}
                </div>
              )}
            </CardBody>
          </Card>
        </div>
        <div className="stack" style={{ minWidth: 0 }}>
          <Card><CardHead title="Details" /><CardBody>
            <KV items={[
              ['Group', group.name], ['Project', project.title], staff && ['Supervisor', project.supervisor?.name], ['Department', project.department?.name],
              ['Milestone', report.milestone?.title], ['Period', report.periodStart ? `${fmtDate(report.periodStart)} - ${fmtDate(report.periodEnd)}` : null],
              ['Deadline', fmtDate(report.deadline)], ['Last submitted', fmtDateTime(report.submittedAt)], ['Description', report.description],
            ]} />
          </CardBody></Card>
          <Card><CardHead title="Review history" /><CardBody>
            {!reviews.length ? <p className="muted small" style={{ margin: 0 }}>No review decisions yet.</p> : (
              <ul className="timeline">{reviews.map((r) => (
                <li key={r._id} className={r.decision === 'approved' ? 'done' : r.decision === 'rejected' ? 'late' : ''}>
                  <div className="row" style={{ gap: 6 }}><StatusBadge status={r.decision} /><span className="muted small">on v{r.version}</span></div>
                  <div className="small muted">{r.reviewer?.name} - {fmtDateTime(r.createdAt)}</div>
                  {r.comments && <div className="pre-wrap mt" style={{ marginTop: 6 }}>{r.comments}</div>}
                </li>))}</ul>
            )}
          </CardBody></Card>
          <Card><CardHead title="Versions" /><CardBody>
            <ul className="list">{versions.map((v) => (
              <li key={v.version} className="row between"><span><strong>v{v.version}</strong> <span className="muted small">{fmtDateTime(v.submittedAt || v.createdAt)}{v.isLate ? ' - late' : ''}</span></span>
                {v.file && <Button variant="ghost" size="sm" icon={Download} aria-label={`Download version ${v.version}`} onClick={() => downloadFile(fileUrl(v), v.file.originalName).catch((e) => toast.error(errMsg(e)))} />}</li>))}</ul>
          </CardBody></Card>
        </div>
      </div>
      <style>{`@media (max-width: 960px) { .grid[style*='2fr'] { grid-template-columns: minmax(0,1fr) !important; } }`}</style>
    </>
  );
}
