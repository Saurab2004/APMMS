import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, Circle, Send, Save } from 'lucide-react';
import { Alert, Button, Card, CardBody, CardHead, EmptyState, Loading, PageHeader } from '../../components/common/ui.jsx';
import { Field, FileInput, Input, Select, TextArea } from '../../components/forms/fields.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { useForm } from '../../hooks/useForm.js';
import { useMyProject } from '../../hooks/useProjects.js';
import { useToast } from '../../context/ToastContext.jsx';
import { api, errMsg, get } from '../../services/api.js';
import { fmtDate } from '../../utils/format.js';
import Hint from '../../components/onboarding/Hint.jsx';

const TYPES = [['weekly', 'Weekly'], ['biweekly', 'Bi-weekly'], ['monthly', 'Monthly'], ['milestone', 'Milestone'], ['midterm', 'Mid-term']];

/** Used for both "Submit new report" (kind=progress) and "Final report submission" (kind=final). */
export default function ReportFormPage({ kind = 'progress' }) {
  const isFinal = kind === 'final';
  const navigate = useNavigate();
  const toast = useToast();
  const mine = useMyProject();
  const projectId = mine.data?.projectId;
  const detail = mine.data?.detail;
  const milestones = useAsync(() => (projectId ? get('/milestones', { project: projectId, limit: 100 }) : Promise.resolve([])), [projectId]);
  const elig = useAsync(() => (isFinal && projectId ? get(`/reports/final-eligibility/${projectId}`) : Promise.resolve(null)), [projectId, isFinal]);
  const f = useForm({ title: isFinal ? 'Final project report' : '', description: '', type: 'weekly', periodStart: '', periodEnd: '', milestone: '', note: '' });
  const [files, setFiles] = useState([]);
  const [extra, setExtra] = useState([]);
  const [busy, setBusy] = useState(false);
  const [fileError, setFileError] = useState('');

  if (mine.loading) return <Loading />;
  if (!projectId) return <Card><EmptyState title="You need a project first">Create or join a group before submitting reports.</EmptyState></Card>;
  const leader = detail?.access === 'leader';
  const ms = (milestones.data || []).filter((m) => !['skipped'].includes(m.status));

  const submit = async (asDraft) => {
    setFileError('');
    if (!asDraft && !files[0]) return setFileError('Attach the report document (PDF or DOCX)');
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('project', projectId); fd.append('kind', kind); fd.append('asDraft', String(asDraft));
      Object.entries(f.values).forEach(([k, v]) => { if (v && !(isFinal && k === 'type')) fd.append(k, v); });
      if (files[0]) fd.append('file', files[0]);
      extra.forEach((x) => fd.append('attachments', x));
      const r = await api.post('/reports', fd);
      const id = r.data.data.report?._id || r.data.data._id;
      toast.success(asDraft ? 'Draft saved' : 'Report submitted - your supervisor has been notified');
      navigate(`/student/reports/${id}`);
    } catch (e) { f.applyError(e); toast.error(errMsg(e)); } finally { setBusy(false); }
  };

  return (
    <>
      <PageHeader title={isFinal ? 'Final report submission' : 'Submit a progress report'} subtitle={isFinal ? 'Your last submission before evaluation. Check eligibility, then upload the final document.' : 'Upload your periodic report for supervisor review.'} />
      <Hint id="student.report" />
      {!leader && <Alert tone="warning" className="mb">Only the Group Leader can submit official reports. You can read the reports your leader submits.</Alert>}
      {isFinal && elig.data && (
        <Card className="mb"><CardHead title="Eligibility checklist" /><CardBody className="stack-sm">
          {elig.data.checks.map((c) => <div key={c.key} className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>{c.passed ? <CheckCircle2 size={18} color="var(--success)" /> : <Circle size={18} color="var(--danger)" />}<span>{c.label}</span></div>)}
          {!elig.data.eligible && <Alert tone="warning">Complete the items above before submitting the final report.{elig.data.existingFinalId && <> <a href={`/student/reports/${elig.data.existingFinalId}`}>Open your existing final report</a>.</>}</Alert>}
        </CardBody></Card>
      )}
      <Card>
        <CardBody>
          <form className="form-grid" onSubmit={(e) => { e.preventDefault(); submit(false); }}>
            <Field label="Title" required className="span-2" error={f.errors.title}><Input {...f.bind('title')} required /></Field>
            {!isFinal && <Field label="Report type" error={f.errors.type}><Select {...f.bind('type')}>{TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>}
            {!isFinal && <Field label="Linked milestone" help="Its planned date becomes the deadline." error={f.errors.milestone}>
              <Select {...f.bind('milestone')}><option value="">None</option>{ms.map((m) => <option key={m._id} value={m._id}>{m.title} - due {fmtDate(m.plannedDate)}</option>)}</Select></Field>}
            {!isFinal && <><Field label="Period start" error={f.errors.periodStart}><Input type="date" {...f.bind('periodStart')} /></Field>
              <Field label="Period end" error={f.errors.periodEnd}><Input type="date" {...f.bind('periodEnd')} /></Field></>}
            <Field label="Description / summary" className="span-2" error={f.errors.description}><TextArea {...f.bind('description')} rows={4} maxLength={3000} /></Field>
            <div className="span-2"><FileInput label="Report document" required accept={['pdf', 'docx']} files={files} onChange={setFiles} error={fileError || f.errors.file} help="PDF or DOCX. PDFs can be previewed by your supervisor." /></div>
            <div className="span-2"><FileInput label="Supporting attachments (optional)" multiple accept={['pdf', 'docx', 'pptx', 'xlsx', 'zip', 'png', 'jpg', 'txt']} files={extra} onChange={setExtra} /></div>
            <div className="span-2 row">
              <Button type="submit" icon={Send} loading={busy} disabled={!leader || (isFinal && elig.data && !elig.data.eligible)}>{isFinal ? 'Submit final report' : 'Submit report'}</Button>
              {!isFinal && <Button variant="secondary" icon={Save} disabled={!leader || busy} onClick={() => submit(true)}>Save as draft</Button>}
            </div>
          </form>
        </CardBody>
      </Card>
    </>
  );
}
