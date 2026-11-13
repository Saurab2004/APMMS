import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Save, Send } from 'lucide-react';
import { Alert, Badge, Button, Card, CardBody, CardHead, ErrorState, KV, Loading, PageHeader, StatusBadge } from '../../components/common/ui.jsx';
import { ConfirmDialog } from '../../components/common/Modal.jsx';
import { Field, Input, TextArea } from '../../components/forms/fields.jsx';
import DocumentPreview from '../../components/reports/DocumentPreview.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { useToast } from '../../context/ToastContext.jsx';
import { errMsg, get, post, put } from '../../services/api.js';

/** Criterion-wise marking. Used by supervisors and by external evaluators (the server decides what each may do). */
export default function EvaluationFormPage({ backTo }) {
  const { projectId, rubricId } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const url = `/evaluations/form/${projectId}/${rubricId}`;
  const state = useAsync(() => get(url), [url]);
  const finalId = state.data?.finalReport?._id;
  const report = useAsync(() => (finalId ? get(`/reports/${finalId}`) : Promise.resolve(null)), [finalId]);
  const [marks, setMarks] = useState({});
  const [remarks, setRemarks] = useState('');
  const [busy, setBusy] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [problems, setProblems] = useState([]);

  useEffect(() => {
    const e = state.data?.evaluation;
    if (e) { setMarks(Object.fromEntries(e.scores.map((s) => [s.criterionId, { marks: s.marks, comment: s.comment || '' }]))); setRemarks(e.remarks || ''); }
  }, [state.data?.evaluation?._id, state.data?.evaluation?.updatedAt]); // eslint-disable-line

  if (state.loading && !state.data) return <Loading />;
  if (state.error && !state.data) return <ErrorState message={state.error} onRetry={state.reload} />;
  const { rubric, evaluation, project, group, evaluatorType } = state.data;
  const locked = evaluation?.status === 'submitted';
  const set = (id, k, v) => setMarks((m) => ({ ...m, [id]: { ...m[id], [k]: v } }));
  const payload = () => ({ remarks, scores: rubric.criteria.map((c) => ({ criterionId: c._id, marks: marks[c._id]?.marks === '' || marks[c._id]?.marks === undefined ? undefined : Number(marks[c._id].marks), comment: marks[c._id]?.comment || '' })).filter((s) => s.marks !== undefined) });
  const total = rubric.criteria.reduce((s, c) => s + (Number(marks[c._id]?.marks) || 0), 0);
  const max = rubric.criteria.reduce((s, c) => s + c.maxMarks, 0);

  const run = async (submit) => {
    setBusy(submit ? 'submit' : 'save'); setProblems([]); setConfirm(false);
    try {
      if (submit) await post(`${url}/submit`, payload()); else await put(url, payload());
      toast.success(submit ? 'Evaluation submitted - it is now final' : 'Draft saved');
      state.reload();
    } catch (e) { setProblems(Array.isArray(e.details) ? e.details : []); toast.error(errMsg(e)); } finally { setBusy(''); }
  };

  const v = report.data?.versions?.[0];
  return (
    <>
      <PageHeader title={`Evaluate: ${group.name}`} subtitle={`${project.title} - ${rubric.name}`} actions={<Button variant="secondary" icon={ArrowLeft} onClick={() => navigate(backTo)}>Back</Button>} />
      <div className="row mb"><Badge tone="indigo">{evaluatorType === 'external' ? 'External evaluation' : 'Supervisor evaluation'}</Badge><StatusBadge status={locked ? 'completed' : 'draft'} label={locked ? 'Submitted (final)' : 'Draft'} /></div>
      {locked && <Alert tone="info" className="mb">This evaluation has been submitted and can no longer be changed. Ask the coordinator to re-open it if a correction is needed.</Alert>}
      {problems.length > 0 && <Alert tone="danger" className="mb"><ul style={{ margin: 0, paddingLeft: 18 }}>{problems.map((p) => <li key={p}>{p}</li>)}</ul></Alert>}
      <div className="grid" style={{ gridTemplateColumns: 'minmax(0,3fr) minmax(0,2fr)', alignItems: 'start' }}>
        <div className="stack" style={{ minWidth: 0 }}>
          <Card><CardHead title="Marks"><strong>{total} / {max}</strong></CardHead><CardBody className="stack">
            {rubric.criteria.map((c) => (
              <div key={c._id} className="stack-sm" style={{ borderBottom: '1px solid var(--border)', paddingBottom: 12 }}>
                <div className="row between"><strong>{c.name}</strong><span className="muted small">max {c.maxMarks} - weight {c.weight}</span></div>
                {c.description && <div className="muted small">{c.description}</div>}
                <div className="form-grid" style={{ gridTemplateColumns: '120px minmax(0,1fr)' }}>
                  <Field label="Marks"><Input type="number" min={0} max={c.maxMarks} step="0.5" disabled={locked} value={marks[c._id]?.marks ?? ''} onChange={(e) => set(c._id, 'marks', e.target.value)} aria-label={`Marks for ${c.name}`} /></Field>
                  <Field label="Comment"><Input disabled={locked} maxLength={1000} value={marks[c._id]?.comment ?? ''} onChange={(e) => set(c._id, 'comment', e.target.value)} /></Field>
                </div>
              </div>))}
            <Field label="Overall remarks"><TextArea disabled={locked} rows={4} maxLength={3000} value={remarks} onChange={(e) => setRemarks(e.target.value)} /></Field>
            {!locked && <div className="row"><Button variant="secondary" icon={Save} loading={busy === 'save'} onClick={() => run(false)}>Save draft</Button><Button icon={Send} loading={busy === 'submit'} onClick={() => setConfirm(true)}>Submit evaluation</Button></div>}
          </CardBody></Card>
        </div>
        <div className="stack" style={{ minWidth: 0 }}>
          <Card><CardHead title="Project" /><CardBody><KV items={[['Title', project.title], ['Group members', group.members?.join(', ')], ['Technologies', project.technologies?.join(', ')], ['Summary', project.summary]]} /></CardBody></Card>
          <Card><CardHead title="Final report" /><CardBody>
            {!finalId ? <p className="muted small" style={{ margin: 0 }}>No final report is available yet.</p> : report.loading ? <Loading /> : v?.file ? <DocumentPreview url={`/reports/${finalId}/versions/${v.version}/file`} file={v.file} /> : <p className="muted small">The final report document is not available.</p>}
          </CardBody></Card>
        </div>
      </div>
      {confirm && <ConfirmDialog title="Submit evaluation?" confirmLabel="Submit (final)" onConfirm={() => run(true)} onClose={() => setConfirm(false)} message="After submission your marks are final. Only the coordinator can re-open them for correction." />}
      <style>{`@media (max-width: 960px) { .grid[style*='3fr'] { grid-template-columns: minmax(0,1fr) !important; } }`}</style>
    </>
  );
}
