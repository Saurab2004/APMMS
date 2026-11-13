import { useState } from 'react';
import { Flag, Plus, Pencil, Trash2, AlertTriangle } from 'lucide-react';
import { Badge, Button, Card, EmptyState, PageHeader, ProgressBar, StatusBadge } from '../../components/common/ui.jsx';
import DataTable from '../../components/tables/DataTable.jsx';
import { ConfirmDialog, Modal } from '../../components/common/Modal.jsx';
import { Field, Input, Select, TextArea } from '../../components/forms/fields.jsx';
import ProjectSelect from '../../components/forms/ProjectSelect.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { useForm } from '../../hooks/useForm.js';
import { usePaged } from '../../hooks/usePaged.js';
import { del, errMsg, patch, post } from '../../services/api.js';
import { fmtDate, toInputDate } from '../../utils/format.js';

function MilestoneForm({ ms, onClose, onSaved }) {
  const toast = useToast();
  const editing = Boolean(ms);
  const f = useForm({ projectId: '', title: ms?.title || '', description: ms?.description || '', plannedDate: toInputDate(ms?.plannedDate), status: ms?.status || 'pending', progress: ms?.progress ?? 0, remarks: ms?.remarks || '' });
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const v = f.values;
      const common = { title: v.title, description: v.description, plannedDate: new Date(v.plannedDate).toISOString() };
      if (editing) await patch(`/milestones/${ms._id}`, { ...common, status: v.status, progress: Number(v.progress), remarks: v.remarks });
      else await post('/milestones', { ...common, projectId: v.projectId });
      toast.success(editing ? 'Milestone updated' : 'Milestone created');
      onSaved();
    } catch (err) { f.applyError(err); toast.error(errMsg(err)); } finally { setBusy(false); }
  };
  return (
    <Modal title={editing ? 'Edit milestone' : 'New milestone'} onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="ms-form" loading={busy}>Save</Button></>}>
      <form id="ms-form" className="stack" onSubmit={submit}>
        {!editing && <Field label="Project" required error={f.errors.projectId}><ProjectSelect value={f.values.projectId} onChange={(v) => f.set('projectId', v)} required /></Field>}
        <Field label="Title" required error={f.errors.title}><Input {...f.bind('title')} required /></Field>
        <Field label="Planned date" required error={f.errors.plannedDate}><Input type="date" {...f.bind('plannedDate')} required /></Field>
        <Field label="Description"><TextArea {...f.bind('description')} /></Field>
        {editing && <>
          <Field label="Status"><Select {...f.bind('status')}><option value="pending">Pending</option><option value="in_progress">In progress</option><option value="completed">Completed</option><option value="skipped">Skipped</option></Select></Field>
          <Field label={`Progress: ${f.values.progress}%`}><input type="range" min={0} max={100} step={5} {...f.bind('progress')} /></Field>
          <Field label="Supervisor remarks"><TextArea {...f.bind('remarks')} /></Field>
        </>}
      </form>
    </Modal>
  );
}

/** Students see their milestones; supervisors and the coordinator can create, edit and delete them. */
export default function MilestonesPage({ initialFilters }) {
  const { user } = useAuth();
  const toast = useToast();
  const canManage = user.role !== 'student';
  const list = usePaged('/milestones', { limit: 15, initialFilters });
  const [form, setForm] = useState(null);
  const [removing, setRemoving] = useState(null);

  const columns = [
    { key: 'title', header: 'Milestone', render: (m) => <div><strong>{m.title}</strong>{m.description && <div className="sub">{m.description}</div>}</div> },
    ...(canManage ? [{ key: 'group', header: 'Group', render: (m) => m.project?.group?.name || '-' }] : []),
    { key: 'plannedDate', header: 'Planned', render: (m) => <span>{fmtDate(m.plannedDate)}{m.overdue && <> <Badge tone="danger">Overdue</Badge></>}</span> },
    { key: 'actualDate', header: 'Actual', render: (m) => fmtDate(m.actualDate) },
    { key: 'status', header: 'Status', render: (m) => <StatusBadge status={m.status} /> },
    { key: 'progress', header: 'Progress', render: (m) => <div style={{ minWidth: 110 }}><ProgressBar value={m.status === 'completed' ? 100 : m.progress} tone={m.overdue ? 'danger' : m.status === 'completed' ? 'success' : undefined} /><span className="sub">{m.status === 'completed' ? 100 : m.progress}%</span></div> },
    { key: 'report', header: 'Report', render: (m) => m.missingReport ? <Badge tone="danger"><AlertTriangle size={12} />Missing</Badge> : m.reportStatus ? <StatusBadge status={m.reportStatus} /> : <span className="muted">-</span> },
    ...(canManage ? [{ key: 'actions', header: '', className: 'actions', render: (m) => (
      <span className="row" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
        <Button variant="secondary" size="sm" icon={Pencil} onClick={() => setForm(m)} aria-label="Edit milestone">Edit</Button>
        <Button variant="ghost" size="sm" icon={Trash2} onClick={() => setRemoving(m)} aria-label="Delete milestone" />
      </span>) }] : []),
  ];

  const confirmDelete = async () => {
    try { await del(`/milestones/${removing._id}`); toast.success('Milestone deleted'); setRemoving(null); list.reload(); } catch (e) { toast.error(errMsg(e)); }
  };

  return (
    <>
      <PageHeader title="Milestones" subtitle="Planned and actual dates, status and progress." actions={canManage && <Button icon={Plus} onClick={() => setForm({})}>New milestone</Button>} />
      <div className="filters">
        <Select aria-label="Status" value={list.filters.status || ''} onChange={(e) => list.setFilter('status', e.target.value)}>
          <option value="">All statuses</option><option value="pending">Pending</option><option value="in_progress">In progress</option><option value="completed">Completed</option><option value="skipped">Skipped</option>
        </Select>
        <Select aria-label="Timing" value={list.filters.overdue ? 'overdue' : list.filters.upcoming ? 'upcoming' : ''} onChange={(e) => { list.setFilter('overdue', e.target.value === 'overdue' ? '1' : ''); list.setFilter('upcoming', e.target.value === 'upcoming' ? '1' : ''); }}>
          <option value="">Any timing</option><option value="overdue">Overdue</option><option value="upcoming">Due in 14 days</option>
        </Select>
      </div>
      <DataTable columns={columns} rows={list.rows} loading={list.loading} error={list.error} onRetry={list.reload} meta={list.meta} onPage={list.setPage} minWidth={760}
        empty={<EmptyState icon={Flag} title="No milestones">{canManage ? 'Create milestones so groups can track their deadlines.' : 'Your supervisor will add project milestones here.'}</EmptyState>} />
      {form && <MilestoneForm ms={form._id ? form : null} onClose={() => setForm(null)} onSaved={() => { setForm(null); list.reload(); }} />}
      {removing && <ConfirmDialog danger title="Delete milestone" confirmLabel="Delete" message={`Delete "${removing.title}"? Reports linked to it keep their deadline.`} onConfirm={confirmDelete} onClose={() => setRemoving(null)} />}
    </>
  );
}
