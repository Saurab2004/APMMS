import { useState } from 'react';
import { ListChecks, Plus, Send } from 'lucide-react';
import { Badge, Button, Card, CardBody, EmptyState, PageHeader, StatusBadge } from '../../components/common/ui.jsx';
import DataState from '../../components/common/DataState.jsx';
import { Modal } from '../../components/common/Modal.jsx';
import { Field, Input, Select, TextArea } from '../../components/forms/fields.jsx';
import { Pagination } from '../../components/tables/DataTable.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { useForm } from '../../hooks/useForm.js';
import { usePaged } from '../../hooks/usePaged.js';
import { useMyProject } from '../../hooks/useProjects.js';
import { errMsg, patch, post } from '../../services/api.js';
import { fmtDateTime, titleCase } from '../../utils/format.js';

function NewLog({ projectId, onClose, onSaved }) {
  const toast = useToast();
  const f = useForm({ type: 'update', title: '', description: '' });
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true);
    try { await post('/interaction-logs', { ...f.values, projectId }); toast.success('Log added'); onSaved(); } catch (err) { f.applyError(err); toast.error(errMsg(err)); } finally { setBusy(false); }
  };
  return (
    <Modal title="New interaction log" onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="log-form" loading={busy}>Add log</Button></>}>
      <form id="log-form" className="stack" onSubmit={submit}>
        <Field label="Type"><Select {...f.bind('type')}><option value="update">Progress update</option><option value="discussion">Discussion</option><option value="issue">Issue / blocker</option><option value="request">Request</option></Select></Field>
        <Field label="Title" required error={f.errors.title}><Input {...f.bind('title')} required /></Field>
        <Field label="Details" required error={f.errors.description}><TextArea {...f.bind('description')} rows={5} required /></Field>
      </form>
    </Modal>
  );
}

function LogCard({ log, canReply, onChanged }) {
  const toast = useToast();
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async (e) => {
    e.preventDefault(); setBusy(true);
    try { await post(`/interaction-logs/${log._id}/responses`, { message: reply }); setReply(''); onChanged(); } catch (err) { toast.error(errMsg(err)); } finally { setBusy(false); }
  };
  const setStatus = async (status) => { try { await patch(`/interaction-logs/${log._id}/status`, { status }); onChanged(); } catch (err) { toast.error(errMsg(err)); } };
  return (
    <Card>
      <CardBody>
        <div className="row between">
          <div className="grow"><h3>{log.title}</h3>
            <div className="muted small">{log.author?.name} - {fmtDateTime(log.createdAt)}{log.project?.group?.name && <> - <Badge tone="indigo">{log.project.group.name}</Badge></>}</div></div>
          <div className="row"><Badge tone="neutral">{titleCase(log.type)}</Badge><StatusBadge status={log.status} /></div>
        </div>
        <p className="pre-wrap mt">{log.description}</p>
        {log.responses?.length > 0 && <ul className="list" style={{ borderTop: '1px solid var(--border)' }}>
          {log.responses.map((r) => <li key={r._id}><strong>{r.author?.name}</strong> <span className="muted small">{r.author?.role} - {fmtDateTime(r.createdAt)}</span><div className="pre-wrap">{r.message}</div></li>)}
        </ul>}
        {canReply && log.status !== 'closed' && (
          <form className="row mt" style={{ flexWrap: 'nowrap', alignItems: 'flex-end' }} onSubmit={send}>
            <div className="grow"><TextArea value={reply} onChange={(e) => setReply(e.target.value)} rows={2} placeholder="Write a response..." aria-label="Response" maxLength={2000} /></div>
            <Button type="submit" icon={Send} loading={busy} disabled={!reply.trim()}>Reply</Button>
          </form>
        )}
        <div className="row mt">
          {log.status !== 'closed' ? <Button variant="secondary" size="sm" onClick={() => setStatus('closed')}>Mark as closed</Button> : <Button variant="secondary" size="sm" onClick={() => setStatus('open')}>Re-open</Button>}
        </div>
      </CardBody>
    </Card>
  );
}

export default function InteractionLogsPage() {
  const { user } = useAuth();
  const isStudent = user.role === 'student';
  const mine = useMyProject();
  const projectId = isStudent ? mine.data?.projectId : undefined;
  const list = usePaged('/interaction-logs', { limit: 10, initialFilters: {} });
  const [adding, setAdding] = useState(false);

  return (
    <>
      <PageHeader title="Interaction log" subtitle="A record of updates, questions and supervisor responses." actions={isStudent && projectId && <Button icon={Plus} onClick={() => setAdding(true)}>New log</Button>} />
      <div className="filters">
        <Select aria-label="Status" value={list.filters.status || ''} onChange={(e) => list.setFilter('status', e.target.value)}>
          <option value="">All statuses</option><option value="open">Open</option><option value="responded">Responded</option><option value="closed">Closed</option>
        </Select>
      </div>
      <DataState loading={list.loading} error={list.error} rows={list.rows} onRetry={list.reload} empty={<Card><EmptyState icon={ListChecks} title="No interaction logs">{isStudent ? 'Add a log to share an update or ask your supervisor a question.' : 'Student updates and questions will appear here.'}</EmptyState></Card>}>
        <div className="stack">
          {list.rows?.map((l) => <LogCard key={l._id} log={l} canReply onChanged={list.reload} />)}
          <Card><Pagination meta={list.meta} onPage={list.setPage} /></Card>
        </div>
      </DataState>
      {adding && projectId && <NewLog projectId={projectId} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); list.reload(); }} />}
    </>
  );
}
