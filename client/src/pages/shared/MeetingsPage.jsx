import { useState } from 'react';
import { CalendarDays, Plus, MapPin, Clock, Pencil } from 'lucide-react';
import { Alert, Badge, Button, Card, CardBody, EmptyState, PageHeader, StatusBadge } from '../../components/common/ui.jsx';
import DataState from '../../components/common/DataState.jsx';
import { Modal } from '../../components/common/Modal.jsx';
import { Field, Input, Select, TextArea } from '../../components/forms/fields.jsx';
import ProjectSelect from '../../components/forms/ProjectSelect.jsx';
import { Pagination } from '../../components/tables/DataTable.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { useForm } from '../../hooks/useForm.js';
import { usePaged } from '../../hooks/usePaged.js';
import { errMsg, patch, post } from '../../services/api.js';
import { fmtDateTime, toInputDateTime } from '../../utils/format.js';

function MeetingForm({ meeting, onClose, onSaved }) {
  const toast = useToast();
  const editing = Boolean(meeting);
  const f = useForm({
    projectId: '', title: meeting?.title || '', agenda: meeting?.agenda || '', scheduledAt: toInputDateTime(meeting?.scheduledAt),
    durationMin: meeting?.durationMin || 30, location: meeting?.location || '', status: meeting?.status || 'scheduled', minutes: meeting?.minutes || '',
  });
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const v = f.values;
      const body = { title: v.title, agenda: v.agenda, scheduledAt: new Date(v.scheduledAt).toISOString(), durationMin: Number(v.durationMin), location: v.location };
      if (editing) await patch(`/meetings/${meeting._id}`, { ...body, status: v.status, minutes: v.minutes });
      else await post('/meetings', { ...body, projectId: v.projectId });
      toast.success(editing ? 'Meeting updated' : 'Meeting scheduled');
      onSaved();
    } catch (err) { f.applyError(err); toast.error(errMsg(err)); } finally { setBusy(false); }
  };
  return (
    <Modal title={editing ? 'Edit meeting' : 'Schedule a meeting'} onClose={onClose} wide
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="meeting-form" loading={busy}>{editing ? 'Save' : 'Schedule'}</Button></>}>
      <form id="meeting-form" className="form-grid" onSubmit={submit}>
        {!editing && <Field label="Project" required className="span-2" error={f.errors.projectId}><ProjectSelect value={f.values.projectId} onChange={(v) => f.set('projectId', v)} required /></Field>}
        <Field label="Title" required className="span-2" error={f.errors.title}><Input {...f.bind('title')} required /></Field>
        <Field label="Date and time" required error={f.errors.scheduledAt}><Input type="datetime-local" {...f.bind('scheduledAt')} required /></Field>
        <Field label="Duration (minutes)" error={f.errors.durationMin}><Input type="number" min={5} max={600} {...f.bind('durationMin')} /></Field>
        <Field label="Location or video link" className="span-2"><Input {...f.bind('location')} /></Field>
        <Field label="Agenda" className="span-2"><TextArea {...f.bind('agenda')} /></Field>
        {editing && <>
          <Field label="Status"><Select {...f.bind('status')}><option value="scheduled">Scheduled</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option></Select></Field>
          <Field label="Minutes / notes" className="span-2" help="Students are notified when minutes are added."><TextArea {...f.bind('minutes')} rows={5} /></Field>
        </>}
      </form>
    </Modal>
  );
}

export default function MeetingsPage() {
  const { user } = useAuth();
  const canManage = user.role !== 'student';
  const list = usePaged('/meetings', { limit: 10 });
  const [form, setForm] = useState(null);

  return (
    <>
      <PageHeader title={canManage ? 'Meetings' : 'Meeting history'} subtitle="Supervision meetings, agendas and recorded minutes."
        actions={canManage && <Button icon={Plus} onClick={() => setForm({})}>Schedule meeting</Button>} />
      <div className="filters">
        <Select aria-label="Status" value={list.filters.status || ''} onChange={(e) => list.setFilter('status', e.target.value)}>
          <option value="">All meetings</option><option value="scheduled">Scheduled</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option>
        </Select>
      </div>
      <DataState loading={list.loading} error={list.error} rows={list.rows} onRetry={list.reload}
        empty={<Card><EmptyState icon={CalendarDays} title="No meetings">{canManage ? 'Schedule a meeting with one of your groups.' : 'Your supervisor will schedule meetings here.'}</EmptyState></Card>}>
        <div className="stack">
          {list.rows?.map((m) => (
            <Card key={m._id}>
              <CardBody>
                <div className="row between">
                  <div className="grow">
                    <h3>{m.title}</h3>
                    <div className="muted small row" style={{ gap: 12, marginTop: 4 }}>
                      <span className="row" style={{ gap: 4 }}><CalendarDays size={14} />{fmtDateTime(m.scheduledAt)}</span>
                      <span className="row" style={{ gap: 4 }}><Clock size={14} />{m.durationMin} min</span>
                      {m.location && <span className="row" style={{ gap: 4 }}><MapPin size={14} />{m.location}</span>}
                      {canManage && m.project?.group?.name && <Badge tone="indigo">{m.project.group.name}</Badge>}
                    </div>
                  </div>
                  <div className="row"><StatusBadge status={m.status} />{canManage && <Button variant="secondary" size="sm" icon={Pencil} onClick={() => setForm(m)}>Edit</Button>}</div>
                </div>
                {m.agenda && <p className="pre-wrap mt" style={{ marginBottom: 0 }}><strong className="small muted">Agenda</strong><br />{m.agenda}</p>}
                {m.minutes && <Alert tone="info" className="mt"><div><strong>Minutes</strong><div className="pre-wrap">{m.minutes}</div></div></Alert>}
              </CardBody>
            </Card>
          ))}
          <Card><Pagination meta={list.meta} onPage={list.setPage} /></Card>
        </div>
      </DataState>
      {form && <MeetingForm meeting={form._id ? form : null} onClose={() => setForm(null)} onSaved={() => { setForm(null); list.reload(); }} />}
    </>
  );
}
