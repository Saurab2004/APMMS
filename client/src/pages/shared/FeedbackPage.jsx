import { useState } from 'react';
import { MessageSquare, Plus, Send, ArrowLeft, Lock } from 'lucide-react';
import { Badge, Button, Card, CardBody, EmptyState, Loading, PageHeader, StatusBadge, Alert } from '../../components/common/ui.jsx';
import DataState from '../../components/common/DataState.jsx';
import { Modal } from '../../components/common/Modal.jsx';
import { Field, Input, Select, TextArea } from '../../components/forms/fields.jsx';
import ProjectSelect from '../../components/forms/ProjectSelect.jsx';
import { Pagination } from '../../components/tables/DataTable.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { useForm } from '../../hooks/useForm.js';
import { usePaged } from '../../hooks/usePaged.js';
import { useMyProject } from '../../hooks/useProjects.js';
import { errMsg, get, patch, post } from '../../services/api.js';
import { fmtDateTime, timeAgo } from '../../utils/format.js';

function NewThread({ fixedProject, onClose, onSaved }) {
  const toast = useToast();
  const f = useForm({ projectId: fixedProject || '', title: '', body: '' });
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true);
    try { const t = await post('/feedback', f.values); toast.success('Discussion started'); onSaved(t); } catch (err) { f.applyError(err); toast.error(errMsg(err)); } finally { setBusy(false); }
  };
  return (
    <Modal title="Start a discussion" onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="thread-form" loading={busy}>Start</Button></>}>
      <form id="thread-form" className="stack" onSubmit={submit}>
        {!fixedProject && <Field label="Project" required error={f.errors.projectId}><ProjectSelect value={f.values.projectId} onChange={(v) => f.set('projectId', v)} required /></Field>}
        <Field label="Subject" required error={f.errors.title}><Input {...f.bind('title')} required /></Field>
        <Field label="Message" required error={f.errors.body}><TextArea {...f.bind('body')} rows={5} required /></Field>
      </form>
    </Modal>
  );
}

function Thread({ id, onBack }) {
  const toast = useToast();
  const state = useAsync(() => get(`/feedback/${id}`), [id]);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async (e) => {
    e.preventDefault(); setBusy(true);
    try { await post(`/feedback/${id}/comments`, { body }); setBody(''); state.reload(); } catch (err) { toast.error(errMsg(err)); } finally { setBusy(false); }
  };
  const toggle = async () => { try { await patch(`/feedback/${id}/status`, { status: state.data.thread.status === 'open' ? 'closed' : 'open' }); state.reload(); } catch (err) { toast.error(errMsg(err)); } };
  if (state.loading && !state.data) return <Loading />;
  if (state.error && !state.data) return <Alert tone="danger">{state.error}</Alert>;
  const { thread, comments } = state.data;
  return (
    <>
      <PageHeader title={thread.title} subtitle={`${thread.kind === 'general' ? 'General discussion' : `Formal ${thread.kind} review`} - started ${fmtDateTime(thread.createdAt)}`}
        actions={<><Button variant="secondary" icon={ArrowLeft} onClick={onBack}>All threads</Button><Button variant="secondary" onClick={toggle}>{thread.status === 'open' ? 'Close thread' : 'Re-open'}</Button></>} />
      <div className="stack">
        {comments.map((c) => (
          <Card key={c._id} style={c.isFormal ? { borderColor: 'var(--indigo)' } : undefined}>
            <CardBody>
              <div className="row between">
                <div><strong>{c.author?.name}</strong> <span className="muted small">{c.author?.role} - {fmtDateTime(c.createdAt)}</span></div>
                {c.isFormal && <span className="row"><Badge tone="indigo"><Lock size={11} />Formal decision</Badge>{c.decision && <StatusBadge status={c.decision} />}</span>}
              </div>
              <div className="pre-wrap mt">{c.body}</div>
            </CardBody>
          </Card>
        ))}
        {thread.status === 'open' ? (
          <Card><CardBody>
            <form className="stack" onSubmit={send}>
              <Field label="Reply"><TextArea value={body} onChange={(e) => setBody(e.target.value)} rows={3} maxLength={4000} /></Field>
              <div><Button type="submit" icon={Send} loading={busy} disabled={!body.trim()}>Post reply</Button></div>
            </form>
          </CardBody></Card>
        ) : <Alert tone="info">This discussion is closed.</Alert>}
      </div>
    </>
  );
}

export default function FeedbackPage() {
  const { user } = useAuth();
  const mine = useMyProject();
  const list = usePaged('/feedback', { limit: 10 });
  const [openId, setOpenId] = useState(null);
  const [adding, setAdding] = useState(false);
  const fixed = user.role === 'student' ? mine.data?.projectId : undefined;

  if (openId) return <Thread id={openId} onBack={() => { setOpenId(null); list.reload(); }} />;
  return (
    <>
      <PageHeader title="Feedback and discussion" subtitle="Formal review comments and general project discussions in one place."
        actions={(user.role !== 'student' || fixed) && <Button icon={Plus} onClick={() => setAdding(true)}>Start discussion</Button>} />
      <div className="filters">
        <Select aria-label="Type" value={list.filters.kind || ''} onChange={(e) => list.setFilter('kind', e.target.value)}>
          <option value="">All types</option><option value="general">General</option><option value="proposal">Proposal reviews</option><option value="report">Report reviews</option>
        </Select>
        <Select aria-label="Status" value={list.filters.status || ''} onChange={(e) => list.setFilter('status', e.target.value)}>
          <option value="">Open and closed</option><option value="open">Open</option><option value="closed">Closed</option>
        </Select>
      </div>
      <DataState loading={list.loading} error={list.error} rows={list.rows} onRetry={list.reload} empty={<Card><EmptyState icon={MessageSquare} title="No feedback yet">Review decisions and discussions will appear here.</EmptyState></Card>}>
        <Card>
          <ul className="list">
            {list.rows?.map((t) => (
              <li key={t._id}>
                <button type="button" className="chat-item" style={{ borderBottom: 0 }} onClick={() => setOpenId(t._id)}>
                  <div className="top"><strong>{t.title}</strong><span className="row" style={{ gap: 6 }}>{t.unread > 0 && <span className="unread-pill">{t.unread} new</span>}<Badge tone={t.kind === 'general' ? 'neutral' : 'indigo'}>{t.kind === 'general' ? 'General' : `Formal - ${t.kind}`}</Badge>{t.status === 'closed' && <StatusBadge status="closed" />}</span></div>
                  <div className="preview">{t.last?.body}</div>
                  <div className="muted small">{t.project?.group?.name} - {timeAgo(t.lastActivityAt)}</div>
                </button>
              </li>
            ))}
          </ul>
          <Pagination meta={list.meta} onPage={list.setPage} />
        </Card>
      </DataState>
      {adding && <NewThread fixedProject={fixed} onClose={() => setAdding(false)} onSaved={(t) => { setAdding(false); setOpenId(t._id); }} />}
    </>
  );
}
