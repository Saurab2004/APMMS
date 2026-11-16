import { useState } from 'react';
import { ArrowRightCircle, CheckCircle2, Pencil, Plus, RotateCcw } from 'lucide-react';
import { Alert, Badge, Button, Card, CardBody, IconButton, PageHeader, StatusBadge } from '../../components/common/ui.jsx';
import DataTable from '../../components/tables/DataTable.jsx';
import { ConfirmDialog, Modal } from '../../components/common/Modal.jsx';
import { Check, Field, Input, Select } from '../../components/forms/fields.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { useForm } from '../../hooks/useForm.js';
import { useToast } from '../../context/ToastContext.jsx';
import { errMsg, get, patch, post } from '../../services/api.js';

function BatchForm({ batch, departments, terms, onClose, onSaved }) {
  const editing = !!batch;
  const f = useForm({ name: batch?.name || '', departmentId: batch?.department?._id || '', intakeYear: batch?.intakeYear || '', termId: batch?.term?._id || '', allowSignup: batch ? batch.allowSignup : true, note: batch?.note || '' });
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const v = f.values;
  const submit = async (e) => {
    e?.preventDefault(); setBusy(true);
    try {
      const common = { name: v.name, intakeYear: v.intakeYear ? Number(v.intakeYear) : undefined, allowSignup: !!v.allowSignup, note: v.note || undefined };
      editing ? await patch(`/batches/${batch._id}`, common) : await post('/batches', { ...common, departmentId: v.departmentId, termId: v.termId || undefined });
      toast.success('Batch saved'); onSaved();
    } catch (err) { f.applyError(err); toast.error(errMsg(err)); } finally { setBusy(false); }
  };
  return (
    <Modal title={editing ? `Edit ${batch.name}` : 'Add batch'} onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={submit}>Save</Button></>}>
      <form className="stack" onSubmit={submit}>
        <Field label="Batch name" required error={f.errors.name} help="For example: 2023 Batch"><Input {...f.bind('name')} maxLength={80} required /></Field>
        {!editing && <Field label="Department" required error={f.errors.departmentId}><Select {...f.bind('departmentId')} required><option value="">Select...</option>{departments.map((d) => <option key={d._id} value={d._id}>{d.name}</option>)}</Select></Field>}
        <Field label="Intake year" error={f.errors.intakeYear}><Input type="number" min={1990} max={2100} {...f.bind('intakeYear')} placeholder="2023" /></Field>
        {!editing && <Field label="Term it is working in now" error={f.errors.termId} help="Groups of this batch get this term's deadlines. You can move the batch to the next term later."><Select {...f.bind('termId')}><option value="">Choose later</option>{terms.map((t) => <option key={t._id} value={t._id}>{t.name}</option>)}</Select></Field>}
        <Check label="Students can pick this batch when they sign up" checked={!!v.allowSignup} onChange={(e) => f.set('allowSignup', e.target.checked)} />
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

function MoveTermDialog({ batch, terms, onClose, onDone }) {
  const [termId, setTermId] = useState('');
  const [moveGroups, setMoveGroups] = useState(true);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const go = async () => {
    setBusy(true);
    try {
      const r = await post(`/batches/${batch._id}/move-term`, { termId, moveGroups });
      toast.success(`${batch.name} moved. ${r.movedGroups} group(s) moved${r.skippedGroups ? `, ${r.skippedGroups} skipped (same group name already in that term)` : ''}.`);
      onDone();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Modal title={`Move ${batch.name} to another term`} onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} disabled={!termId} onClick={go}>Move batch</Button></>}>
      <div className="stack">
        <p className="muted" style={{ margin: 0 }}>Use this when the batch starts its next semester. Its students follow the new term and get its deadlines.</p>
        <Field label="New term" required><Select aria-label="New term" value={termId} onChange={(e) => setTermId(e.target.value)}><option value="">Select...</option>{terms.filter((t) => t._id !== batch.term?._id).map((t) => <option key={t._id} value={t._id}>{t.name}</option>)}</Select></Field>
        <Check label="Also move this batch's unfinished groups and projects" checked={moveGroups} onChange={(e) => setMoveGroups(e.target.checked)} />
      </div>
    </Modal>
  );
}

function WorkloadCard() {
  const state = useAsync(() => get('/batches/workload'), []);
  const cols = [
    { key: 'name', header: 'Supervisor', render: (s) => <><strong>{s.name}</strong><div className="muted small">{s.department?.name}</div></> },
    { key: 'total', header: 'Projects', render: (s) => <span>{s.total} / {s.maxProjects}{s.total >= s.maxProjects && <> <Badge tone="warning">Full</Badge></>}</span> },
    { key: 'per', header: 'By batch', render: (s) => s.perBatch.length ? <span className="row" style={{ gap: 6 }}>{s.perBatch.map((p) => <Badge key={p.batch?._id || 'none'}>{p.batch?.name || 'No batch'}: {p.count}</Badge>)}</span> : <span className="muted">-</span> },
  ];
  return (
    <>
      <h2 style={{ marginTop: 28 }}>Supervisor workload by batch</h2>
      <p className="muted small">How many unfinished projects each supervisor has, split by batch. One supervisor can work with several batches.</p>
      <DataTable columns={cols} rows={state.data} loading={state.loading} error={state.error} onRetry={state.reload} minWidth={560} />
    </>
  );
}

export default function BatchesPage() {
  const [showAll, setShowAll] = useState(false);
  const state = useAsync(() => get('/batches', showAll ? { all: 1 } : {}), [showAll]);
  const lookups = useAsync(() => Promise.all([get('/departments'), get('/academic-terms')]), []);
  const [departments, allTerms] = lookups.data || [[], []];
  const terms = allTerms.filter((t) => t.isActive !== false);
  const [form, setForm] = useState(null);
  const [moving, setMoving] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const toast = useToast();
  const setStatus = async () => {
    try { await patch(`/batches/${confirm.batch._id}`, { status: confirm.status }); toast.success(confirm.status === 'completed' ? 'Batch marked completed' : 'Batch re-opened'); setConfirm(null); state.reload(); }
    catch (e) { toast.error(errMsg(e)); }
  };
  const cols = [
    { key: 'name', header: 'Batch', render: (b) => <><strong>{b.name}</strong><div className="muted small">{b.department?.name}{b.intakeYear ? ` - intake ${b.intakeYear}` : ''}</div></> },
    { key: 'term', header: 'Current term', render: (b) => b.term?.name || <Badge tone="warning">No term yet</Badge> },
    { key: 'students', header: 'Students' },
    { key: 'groups', header: 'Active groups' },
    { key: 'signup', header: 'Sign-up', render: (b) => (b.allowSignup ? 'Open' : 'Closed') },
    { key: 'status', header: 'Status', render: (b) => <StatusBadge status={b.status === 'active' ? 'active' : 'inactive'} label={b.status === 'active' ? 'Active' : 'Completed'} /> },
    { key: 'a', header: '', render: (b) => (
      <div className="row" style={{ gap: 2, flexWrap: 'nowrap' }}>
        <IconButton icon={Pencil} label={`Edit ${b.name}`} onClick={() => setForm({ batch: b })} />
        {b.status === 'active' && <IconButton icon={ArrowRightCircle} label={`Move ${b.name} to another term`} onClick={() => setMoving(b)} />}
        {b.status === 'active'
          ? <IconButton icon={CheckCircle2} label={`Mark ${b.name} completed`} onClick={() => setConfirm({ batch: b, status: 'completed' })} />
          : <IconButton icon={RotateCcw} label={`Re-open ${b.name}`} onClick={() => setConfirm({ batch: b, status: 'active' })} />}
      </div>
    ) },
  ];
  return (
    <>
      <PageHeader title="Batches" subtitle="A department can have many batches (for example 2022, 2023, 2024). Each batch works in its own term with its own deadlines." actions={<Button icon={Plus} onClick={() => setForm({})}>Add batch</Button>} />
      <Alert className="mb">Students pick their batch when they sign up. Their groups, proposals and reports then follow that batch's term. When a batch starts its next semester, use "Move to another term" once for the whole batch.</Alert>
      <div className="mb"><Check label="Show completed batches too" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /></div>
      <DataTable columns={cols} rows={state.data} loading={state.loading} error={state.error} onRetry={state.reload} minWidth={760} />
      <WorkloadCard />
      {form && <BatchForm batch={form.batch} departments={departments} terms={terms} onClose={() => setForm(null)} onSaved={() => { setForm(null); state.reload(); }} />}
      {moving && <MoveTermDialog batch={moving} terms={terms} onClose={() => setMoving(null)} onDone={() => { setMoving(null); state.reload(); }} />}
      {confirm && <ConfirmDialog title={confirm.status === 'completed' ? 'Mark batch completed' : 'Re-open batch'} message={confirm.status === 'completed' ? `${confirm.batch.name} will be closed: no new groups or sign-ups. Its data stays for records and reports.` : `${confirm.batch.name} will become active again (sign-up stays closed until you open it).`} confirmLabel={confirm.status === 'completed' ? 'Mark completed' : 'Re-open'} onConfirm={setStatus} onClose={() => setConfirm(null)} />}
    </>
  );
}
