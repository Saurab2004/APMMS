import { useState } from 'react';
import { Pencil, Plus } from 'lucide-react';
import { Alert, Badge, Button, Card, IconButton, PageHeader, StatusBadge } from '../../components/common/ui.jsx';
import DataTable from '../../components/tables/DataTable.jsx';
import { Modal } from '../../components/common/Modal.jsx';
import { Check, Field, Input, TextArea } from '../../components/forms/fields.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { useForm } from '../../hooks/useForm.js';
import { useToast } from '../../context/ToastContext.jsx';
import { errMsg, get, patch, post } from '../../services/api.js';
import { fmtDate, toInputDate } from '../../utils/format.js';

function DepartmentForm({ dep, onClose, onSaved }) {
  const f = useForm({ name: dep?.name || '', code: dep?.code || '', description: dep?.description || '', isActive: dep ? dep.isActive : true });
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const submit = async (e) => {
    e?.preventDefault(); setBusy(true);
    try { const body = { ...f.values, code: f.values.code.toUpperCase() }; dep ? await patch(`/departments/${dep._id}`, body) : await post('/departments', body); toast.success('Department saved'); onSaved(); }
    catch (err) { f.applyError(err); toast.error(errMsg(err)); } finally { setBusy(false); }
  };
  return (
    <Modal title={dep ? 'Edit department' : 'Add department'} onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={submit}>Save</Button></>}>
      <form className="stack" onSubmit={submit}>
        <Field label="Name" required error={f.errors.name}><Input {...f.bind('name')} maxLength={120} required /></Field>
        <Field label="Code" required help="Short code, e.g. CSE" error={f.errors.code}><Input {...f.bind('code')} maxLength={12} required /></Field>
        <Field label="Description" error={f.errors.description}><TextArea rows={3} {...f.bind('description')} maxLength={500} /></Field>
        <Check label="Active (available for selection)" checked={!!f.values.isActive} onChange={(e) => f.set('isActive', e.target.checked)} />
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

export function DepartmentsPage() {
  const state = useAsync(() => get('/departments', { all: 1 }), []);
  const [form, setForm] = useState(null);
  const cols = [
    { key: 'name', header: 'Department', render: (d) => <><strong>{d.name}</strong><div className="muted small">{d.description}</div></> },
    { key: 'code', header: 'Code' },
    { key: 'students', header: 'Students' },
    { key: 'supervisors', header: 'Supervisors' },
    { key: 'isActive', header: 'Status', render: (d) => <StatusBadge status={d.isActive ? 'active' : 'inactive'} label={d.isActive ? 'Active' : 'Inactive'} /> },
    { key: 'a', header: '', render: (d) => <IconButton icon={Pencil} label={`Edit ${d.name}`} onClick={() => setForm({ dep: d })} /> },
  ];
  return (
    <>
      <PageHeader title="Departments" subtitle="Departments are deactivated rather than deleted so old projects keep their department." actions={<Button icon={Plus} onClick={() => setForm({})}>Add department</Button>} />
      <DataTable columns={cols} rows={state.data} loading={state.loading} error={state.error} onRetry={state.reload} />
      {form && <DepartmentForm dep={form.dep} onClose={() => setForm(null)} onSaved={() => { setForm(null); state.reload(); }} />}
    </>
  );
}

function TermForm({ term, onClose, onSaved }) {
  const f = useForm({
    name: term?.name || '', academicYear: term?.academicYear || '', semester: term?.semester || '',
    startDate: toInputDate(term?.startDate), endDate: toInputDate(term?.endDate),
    proposalDeadline: toInputDate(term?.deadlines?.proposal), finalReportDeadline: toInputDate(term?.deadlines?.finalReport), isCurrent: !!term?.isCurrent, isActive: term ? term.isActive !== false : true,
  });
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const submit = async (e) => {
    e?.preventDefault(); setBusy(true);
    try {
      const body = Object.fromEntries(Object.entries(f.values).filter(([, v]) => v !== '' && v !== undefined));
      term ? await patch(`/academic-terms/${term._id}`, body) : await post('/academic-terms', body);
      toast.success('Academic term saved'); onSaved();
    } catch (err) { f.applyError(err); toast.error(errMsg(err)); } finally { setBusy(false); }
  };
  return (
    <Modal wide title={term ? 'Edit academic term' : 'Add academic term'} onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={submit}>Save</Button></>}>
      <form className="form-grid" onSubmit={submit}>
        <Field label="Term name" required error={f.errors.name}><Input {...f.bind('name')} placeholder="Spring 2026" required /></Field>
        <Field label="Academic year" required error={f.errors.academicYear}><Input {...f.bind('academicYear')} placeholder="2025-26" required /></Field>
        <Field label="Semester" required error={f.errors.semester}><Input {...f.bind('semester')} placeholder="Spring" required /></Field>
        <span />
        <Field label="Start date" required error={f.errors.startDate}><Input type="date" {...f.bind('startDate')} required /></Field>
        <Field label="End date" required error={f.errors.endDate}><Input type="date" {...f.bind('endDate')} required /></Field>
        <Field label="Proposal deadline" error={f.errors.proposalDeadline}><Input type="date" {...f.bind('proposalDeadline')} /></Field>
        <Field label="Final report deadline" error={f.errors.finalReportDeadline}><Input type="date" {...f.bind('finalReportDeadline')} /></Field>
        <div style={{ gridColumn: '1 / -1' }}><Check label="Default term (only used for students who are not in any batch)" checked={!!f.values.isCurrent} onChange={(e) => f.set('isCurrent', e.target.checked)} /></div>
        {term && <div style={{ gridColumn: '1 / -1' }}><Check label="Active (untick to archive an old term; its data stays)" checked={!!f.values.isActive} onChange={(e) => f.set('isActive', e.target.checked)} /></div>}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

export function AcademicStructurePage() {
  const state = useAsync(() => get('/academic-terms'), []);
  const [form, setForm] = useState(null);
  const cols = [
    { key: 'name', header: 'Term', render: (t) => <><strong>{t.name}</strong>{t.isCurrent && <> <Badge tone="success">Default</Badge></>}{t.isActive === false && <> <Badge>Archived</Badge></>}<div className="muted small">{t.academicYear} - {t.semester}</div></> },
    { key: 'dates', header: 'Dates', render: (t) => `${fmtDate(t.startDate)} to ${fmtDate(t.endDate)}` },
    { key: 'p', header: 'Proposal deadline', render: (t) => fmtDate(t.deadlines?.proposal) },
    { key: 'f', header: 'Final report deadline', render: (t) => fmtDate(t.deadlines?.finalReport) },
    { key: 'a', header: '', render: (t) => <IconButton icon={Pencil} label={`Edit ${t.name}`} onClick={() => setForm({ term: t })} /> },
  ];
  return (
    <>
      <PageHeader title="Academic structure" subtitle="Terms and their deadlines. Many terms can be active at the same time; each batch works in one of them." actions={<Button icon={Plus} onClick={() => setForm({})}>Add term</Button>} />
      <Alert className="mb">Deadlines set here are used for late-submission checks and deadline reminders. Link a batch to a term on the <a href="/coordinator/batches">Batches</a> page.</Alert>
      <DataTable columns={cols} rows={state.data} loading={state.loading} error={state.error} onRetry={state.reload} minWidth={640} />
      {form && <TermForm term={form.term} onClose={() => setForm(null)} onSaved={() => { setForm(null); state.reload(); }} />}
    </>
  );
}
