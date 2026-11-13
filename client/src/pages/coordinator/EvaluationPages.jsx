import { useState } from 'react';
import { Download, Eye, EyeOff, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { Alert, Badge, Button, Card, CardBody, CardHead, IconButton, Loading, ErrorState, PageHeader, StatusBadge, Tabs } from '../../components/common/ui.jsx';
import DataTable from '../../components/tables/DataTable.jsx';
import { ConfirmDialog, Modal } from '../../components/common/Modal.jsx';
import { Check, Field, Input, Select, TextArea } from '../../components/forms/fields.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { useToast } from '../../context/ToastContext.jsx';
import { downloadFile, errMsg, get, patch, post } from '../../services/api.js';
import { fmtDateTime } from '../../utils/format.js';

const blankCriterion = () => ({ name: '', description: '', maxMarks: 10, weight: 1 });

function RubricForm({ rubric, onClose, onSaved }) {
  const toast = useToast();
  const locked = rubric && rubric.evaluationCount > 0;
  const [v, setV] = useState({
    name: rubric?.name || '', stage: rubric?.stage || 'Final defence', description: rubric?.description || '',
    supervisor: rubric ? rubric.appliesTo.includes('supervisor') : true, external: rubric ? rubric.appliesTo.includes('external') : false,
    isActive: rubric ? rubric.isActive : true, aggregation: rubric?.gradingRules?.aggregation || 'none',
    bands: (rubric?.gradingRules?.bands || []).map((b) => ({ ...b })),
    criteria: (rubric?.criteria || [blankCriterion()]).map((c) => ({ ...c })),
  });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const set = (k, val) => setV((x) => ({ ...x, [k]: val }));
  const setCrit = (i, k, val) => set('criteria', v.criteria.map((c, j) => (j === i ? { ...c, [k]: val } : c)));
  const setBand = (i, k, val) => set('bands', v.bands.map((c, j) => (j === i ? { ...c, [k]: val } : c)));
  const maxTotal = v.criteria.reduce((s, c) => s + (Number(c.maxMarks) || 0), 0);

  const save = async () => {
    setBusy(true); setErrors({});
    const appliesTo = [v.supervisor && 'supervisor', v.external && 'external'].filter(Boolean);
    const body = {
      name: v.name, stage: v.stage, description: v.description, appliesTo, isActive: v.isActive,
      gradingRules: { aggregation: v.aggregation, bands: v.bands.filter((b) => b.grade).map((b) => ({ min: Number(b.min), grade: b.grade })) },
    };
    if (!locked) body.criteria = v.criteria.map((c) => ({ ...c, maxMarks: Number(c.maxMarks), weight: Number(c.weight) }));
    try { rubric ? await patch(`/evaluations/rubrics/${rubric._id}`, body) : await post('/evaluations/rubrics', body); toast.success('Rubric saved'); onSaved(); }
    catch (e) { if (e.details && !Array.isArray(e.details)) setErrors(e.details); toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Modal wide title={rubric ? 'Edit rubric' : 'Create rubric'} onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>Save rubric</Button></>}>
      <div className="stack">
        {locked && <Alert tone="warning">Marks have already been entered with this rubric, so its criteria are locked. You can still change the name, who it applies to and grading bands.</Alert>}
        <div className="form-grid">
          <Field label="Rubric name" required error={errors.name}><Input value={v.name} onChange={(e) => set('name', e.target.value)} maxLength={120} /></Field>
          <Field label="Stage" required error={errors.stage}><Input value={v.stage} onChange={(e) => set('stage', e.target.value)} maxLength={60} /></Field>
        </div>
        <Field label="Description"><TextArea rows={2} value={v.description} onChange={(e) => set('description', e.target.value)} maxLength={500} /></Field>
        <div className="row"><strong>Used by:</strong><Check label="Supervisors" checked={v.supervisor} onChange={(e) => set('supervisor', e.target.checked)} /><Check label="External evaluators" checked={v.external} onChange={(e) => set('external', e.target.checked)} /><Check label="Active" checked={v.isActive} onChange={(e) => set('isActive', e.target.checked)} /></div>
        <div>
          <div className="row between mb"><strong>Criteria (total {maxTotal} marks)</strong>{!locked && <Button size="sm" variant="secondary" icon={Plus} disabled={v.criteria.length >= 30} onClick={() => set('criteria', [...v.criteria, blankCriterion()])}>Add criterion</Button>}</div>
          {errors.criteria && <Alert tone="danger" className="mb">{String(errors.criteria)}</Alert>}
          <div className="stack-sm">{v.criteria.map((c, i) => (
            <div key={c._id || i} className="row" style={{ alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <Field label={i === 0 ? 'Criterion' : undefined}><Input aria-label={`Criterion ${i + 1} name`} disabled={locked} value={c.name} onChange={(e) => setCrit(i, 'name', e.target.value)} maxLength={120} style={{ minWidth: 200 }} /></Field>
              <Field label={i === 0 ? 'Max marks' : undefined}><Input aria-label={`Criterion ${i + 1} max marks`} type="number" min={1} disabled={locked} value={c.maxMarks} onChange={(e) => setCrit(i, 'maxMarks', e.target.value)} style={{ width: 90 }} /></Field>
              <Field label={i === 0 ? 'Weight' : undefined}><Input aria-label={`Criterion ${i + 1} weight`} type="number" min={0} step="0.5" disabled={locked} value={c.weight} onChange={(e) => setCrit(i, 'weight', e.target.value)} style={{ width: 80 }} /></Field>
              {!locked && v.criteria.length > 1 && <IconButton icon={Trash2} label={`Remove criterion ${i + 1}`} onClick={() => set('criteria', v.criteria.filter((_, j) => j !== i))} />}
            </div>))}</div>
        </div>
        <div>
          <Field label="Combine several evaluators' marks" help="When 'average', supervisor and external percentages are averaged into one result."><Select value={v.aggregation} onChange={(e) => set('aggregation', e.target.value)}><option value="none">Show each evaluator separately</option><option value="average">Average of submitted evaluations</option></Select></Field>
          <div className="row between mb mt"><strong>Grade bands (optional)</strong><Button size="sm" variant="secondary" icon={Plus} onClick={() => set('bands', [...v.bands, { min: 0, grade: '' }])}>Add band</Button></div>
          {v.bands.map((b, i) => (<div key={i} className="row mb"><span className="muted small">From</span><Input aria-label={`Band ${i + 1} minimum percentage`} type="number" min={0} max={100} value={b.min} onChange={(e) => setBand(i, 'min', e.target.value)} style={{ width: 90 }} /><span className="muted small">% =</span><Input aria-label={`Band ${i + 1} grade`} value={b.grade} maxLength={6} onChange={(e) => setBand(i, 'grade', e.target.value)} style={{ width: 90 }} /><IconButton icon={Trash2} label={`Remove band ${i + 1}`} onClick={() => set('bands', v.bands.filter((_, j) => j !== i))} /></div>))}
        </div>
      </div>
    </Modal>
  );
}

function Rubrics() {
  const state = useAsync(() => get('/evaluations/rubrics'), []);
  const [form, setForm] = useState(null);
  const cols = [
    { key: 'name', header: 'Rubric', render: (r) => <><strong>{r.name}</strong><div className="muted small">{r.stage}</div></> },
    { key: 'c', header: 'Criteria', render: (r) => `${r.criteria.length} (${r.criteria.reduce((s, c) => s + c.maxMarks, 0)} marks)` },
    { key: 'u', header: 'Used by', render: (r) => r.appliesTo.map((a) => <Badge key={a} tone={a === 'external' ? 'indigo' : 'info'}>{a === 'external' ? 'External' : 'Supervisor'}</Badge>) },
    { key: 'n', header: 'Evaluations', render: (r) => r.evaluationCount },
    { key: 's', header: 'Status', render: (r) => <StatusBadge status={r.isActive ? 'active' : 'inactive'} label={r.isActive ? 'Active' : 'Inactive'} /> },
    { key: 'a', header: '', render: (r) => <IconButton icon={Pencil} label={`Edit ${r.name}`} onClick={() => setForm({ rubric: r })} /> },
  ];
  return (
    <>
      <div className="row between mb"><p className="muted" style={{ margin: 0 }}>Rubrics define the criteria evaluators mark against.</p><Button icon={Plus} onClick={() => setForm({})}>Create rubric</Button></div>
      <DataTable columns={cols} rows={state.data} loading={state.loading} error={state.error} onRetry={state.reload} minWidth={640} />
      {form && <RubricForm rubric={form.rubric} onClose={() => setForm(null)} onSaved={() => { setForm(null); state.reload(); }} />}
    </>
  );
}

function ResultsModal({ projectId, onClose, onChanged }) {
  const toast = useToast();
  const state = useAsync(() => get(`/evaluations/results/${projectId}`), [projectId]);
  const [reopen, setReopen] = useState(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const publish = async (publishIt) => {
    setBusy(true);
    try { await post(`/evaluations/results/${projectId}/publish`, { publish: publishIt }); toast.success(publishIt ? 'Results published to students' : 'Results hidden'); state.reload(); onChanged(); }
    catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  const doReopen = async () => {
    setBusy(true);
    try { await post(`/evaluations/${reopen._id}/reopen`, { reason }); toast.success('Evaluation re-opened for correction'); setReopen(null); setReason(''); state.reload(); onChanged(); }
    catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  const d = state.data;
  return (
    <Modal wide title={d ? `Results: ${d.project.group?.name}` : 'Results'} onClose={onClose} footer={d && <>
      <Button variant="secondary" onClick={onClose}>Close</Button>
      <Button variant="secondary" icon={Download} onClick={() => downloadFile(`/evaluations/results/${projectId}/report.pdf`, 'evaluation-report.pdf').catch((e) => toast.error(errMsg(e)))}>PDF report</Button>
      {d.project.resultsPublished ? <Button variant="secondary" icon={EyeOff} loading={busy} onClick={() => publish(false)}>Hide from students</Button> : <Button icon={Eye} loading={busy} onClick={() => publish(true)}>Publish to students</Button>}</>}>
      {state.loading && !d ? <Loading /> : state.error && !d ? <ErrorState message={state.error} onRetry={state.reload} /> : (
        <div className="stack">
          <div className="row"><strong>{d.project.title}</strong><StatusBadge status={d.project.resultsPublished ? 'published' : 'unpublished'} /></div>
          {!d.results.length && <p className="muted">No evaluations have been started for this project.</p>}
          {d.results.map((r) => (
            <Card key={r.rubric._id}><CardHead title={r.rubric.name}>{r.aggregate.percentage != null && <strong>Combined {r.aggregate.percentage}% {r.aggregate.grade && `(${r.aggregate.grade})`}</strong>}</CardHead><CardBody className="stack">
              {r.evaluations.map((e) => (
                <div key={e._id} className="row between" style={{ borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
                  <span><strong>{e.evaluator?.name}</strong> <Badge tone={e.evaluatorType === 'external' ? 'indigo' : 'info'}>{e.evaluatorType}</Badge><div className="muted small">{e.status === 'submitted' ? `Submitted ${fmtDateTime(e.submittedAt)}` : 'Draft - not submitted'}{e.reopenCount ? ` - re-opened ${e.reopenCount}x` : ''}</div></span>
                  <span className="row">{e.status === 'submitted' && <><strong>{e.total}/{e.maxTotal} ({e.percentage}%){e.grade && ` - ${e.grade}`}</strong><Button size="sm" variant="secondary" icon={RotateCcw} onClick={() => setReopen(e)}>Re-open</Button></>}</span>
                </div>))}
            </CardBody></Card>))}
        </div>)}
      {reopen && (
        <Modal title="Re-open evaluation" onClose={() => setReopen(null)} footer={<><Button variant="secondary" onClick={() => setReopen(null)}>Cancel</Button><Button loading={busy} disabled={reason.trim().length < 5} onClick={doReopen}>Re-open</Button></>}>
          <p style={{ marginTop: 0 }}>{reopen.evaluator?.name} will be able to edit and re-submit. This is recorded in the audit log.</p>
          <Field label="Reason" required><TextArea rows={3} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} /></Field>
        </Modal>)}
    </Modal>
  );
}

function Results() {
  const state = useAsync(() => get('/evaluations/overview'), []);
  const [open, setOpen] = useState(null);
  const cols = [
    { key: 'g', header: 'Group', render: (p) => <><strong>{p.group?.name}</strong><div className="muted small">{p.title}</div></> },
    { key: 'st', header: 'Stage', render: (p) => <StatusBadge status={p.status} /> },
    { key: 'sup', header: 'Supervisor eval', render: (p) => `${p.supervisorSubmitted} submitted` },
    { key: 'ext', header: 'External eval', render: (p) => `${p.externalSubmitted} submitted${p.externalAssigned ? ` (${p.externalAssigned} assigned)` : ''}` },
    { key: 'dr', header: 'Drafts', render: (p) => p.drafts },
    { key: 'pub', header: 'Results', render: (p) => <StatusBadge status={p.resultsPublished ? 'published' : 'unpublished'} /> },
    { key: 'a', header: '', render: (p) => <Button size="sm" variant="secondary" onClick={() => setOpen(p._id)}>Open</Button> },
  ];
  return (
    <>
      <DataTable columns={cols} rows={state.data} loading={state.loading} error={state.error} onRetry={state.reload} minWidth={720} />
      {open && <ResultsModal projectId={open} onClose={() => setOpen(null)} onChanged={state.reload} />}
    </>
  );
}

export default function EvaluationManagementPage() {
  const [tab, setTab] = useState('results');
  return (
    <>
      <PageHeader title="Evaluation management" subtitle="Rubrics, submitted marks and publishing results to students." />
      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'results', label: 'Results & publishing' }, { key: 'rubrics', label: 'Rubrics' }]} />
      <div className="mt">{tab === 'results' ? <Results /> : <Rubrics />}</div>
    </>
  );
}
