import { useState } from 'react';
import { CalendarPlus, Copy, Plus, ShieldOff } from 'lucide-react';
import { Alert, Button, PageHeader, StatusBadge } from '../../components/common/ui.jsx';
import DataTable from '../../components/tables/DataTable.jsx';
import { ConfirmDialog, Modal } from '../../components/common/Modal.jsx';
import { Field, Input, SearchInput } from '../../components/forms/fields.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { useForm } from '../../hooks/useForm.js';
import { useToast } from '../../context/ToastContext.jsx';
import { errMsg, get, getPaged, patch, post } from '../../services/api.js';
import { fmtDateTime } from '../../utils/format.js';

const inDays = (n) => { const d = new Date(Date.now() + n * 864e5); return d.toISOString().slice(0, 10); };
const endOfDay = (s) => new Date(`${s}T23:59:00`).toISOString();

function InviteForm({ onClose, onSaved }) {
  const toast = useToast();
  const f = useForm({ name: '', email: '', organization: '', rubricId: '', sessionLabel: '', expires: inDays(14) });
  const rubrics = useAsync(() => get('/evaluations/rubrics'), []);
  const [q, setQ] = useState('');
  const found = useAsync(() => getPaged('/projects', { q: q || undefined, limit: 30 }), [q]);
  const [chosen, setChosen] = useState({});
  const [busy, setBusy] = useState(false);
  const external = (rubrics.data || []).filter((r) => r.isActive && r.appliesTo.includes('external'));
  const ids = Object.keys(chosen).filter((k) => chosen[k]);
  const submit = async () => {
    setBusy(true);
    try {
      const r = await post('/external-evaluators', { name: f.values.name, email: f.values.email, organization: f.values.organization, rubricId: f.values.rubricId, sessionLabel: f.values.sessionLabel, projectIds: ids, expiresAt: endOfDay(f.values.expires) });
      toast.success('Evaluator access created'); onSaved(r.temporaryPassword ? { email: f.values.email, password: r.temporaryPassword } : { email: f.values.email });
    } catch (e) { f.applyError(e); toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Modal wide title="Invite external evaluator" onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} disabled={!ids.length} onClick={submit}>Create access ({ids.length} project{ids.length === 1 ? '' : 's'})</Button></>}>
      <div className="stack">
        <div className="form-grid">
          <Field label="Name" required error={f.errors.name}><Input {...f.bind('name')} maxLength={120} /></Field>
          <Field label="Email" required error={f.errors.email}><Input type="email" {...f.bind('email')} /></Field>
          <Field label="Organization" error={f.errors.organization}><Input {...f.bind('organization')} maxLength={150} /></Field>
          <Field label="Session label" help="e.g. Final defence panel A" error={f.errors.sessionLabel}><Input {...f.bind('sessionLabel')} maxLength={120} /></Field>
          <Field label="Rubric (must allow external evaluators)" required error={f.errors.rubricId}>
            <select className="select" {...f.bind('rubricId')}><option value="">Select...</option>{external.map((r) => <option key={r._id} value={r._id}>{r.name}</option>)}</select></Field>
          <Field label="Access expires on" required error={f.errors.expiresAt}><Input type="date" min={inDays(1)} {...f.bind('expires')} /></Field>
        </div>
        {!external.length && !rubrics.loading && <Alert tone="warning">No active rubric is enabled for external evaluators. Create one in Evaluation management first.</Alert>}
        <div><strong>Projects the evaluator may see</strong>{f.errors.projectIds && <div className="field-error">{String(f.errors.projectIds)}</div>}
          <div className="mt"><SearchInput value={q} onChange={setQ} placeholder="Search projects" /></div>
          <div style={{ maxHeight: 220, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8, padding: 8, marginTop: 8 }}>
            {(found.data?.items || []).map((p) => (<label key={p._id} className="check" style={{ display: 'flex', padding: '4px 0' }}><input type="checkbox" checked={!!chosen[p._id]} onChange={(e) => setChosen((c) => ({ ...c, [p._id]: e.target.checked }))} /><span>{p.group?.name} - {p.title}</span></label>))}
            {!found.loading && !(found.data?.items || []).length && <p className="muted small">No projects match.</p>}
          </div></div>
        <p className="muted small" style={{ margin: 0 }}>The evaluator only sees the projects you tick here, and only after the final report is approved. Access ends automatically on the expiry date.</p>
      </div>
    </Modal>
  );
}

export default function ExternalEvaluatorsPage() {
  const toast = useToast();
  const state = useAsync(() => get('/external-evaluators'), []);
  const [invite, setInvite] = useState(false);
  const [created, setCreated] = useState(null);
  const [revoke, setRevoke] = useState(null);
  const [extend, setExtend] = useState(null);
  const [date, setDate] = useState(inDays(14));
  const [busy, setBusy] = useState(false);
  const run = async (fn, msg) => { setBusy(true); try { await fn(); toast.success(msg); setRevoke(null); setExtend(null); state.reload(); } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); } };
  const cols = [
    { key: 'e', header: 'Evaluator', render: (a) => <><strong>{a.evaluator?.name}</strong><div className="muted small">{a.evaluator?.email}{a.evaluator?.organization && ` - ${a.evaluator.organization}`}</div></> },
    { key: 'r', header: 'Rubric / session', render: (a) => <>{a.rubric?.name}<div className="muted small">{a.sessionLabel}</div></> },
    { key: 'p', header: 'Projects', render: (a) => <span title={a.projects.map((p) => p.group?.name).join(', ')}>{a.submitted}/{a.total} evaluated</span> },
    { key: 'x', header: 'Access ends', render: (a) => fmtDateTime(a.expiresAt) },
    { key: 's', header: 'Status', render: (a) => <StatusBadge status={a.state} /> },
    { key: 'a', header: '', render: (a) => (a.status === 'active' ? <div className="row" style={{ flexWrap: 'nowrap' }}><Button size="sm" variant="secondary" icon={CalendarPlus} onClick={() => { setExtend(a); setDate(inDays(14)); }}>Extend</Button><Button size="sm" variant="secondary" icon={ShieldOff} onClick={() => setRevoke(a)}>Revoke</Button></div> : null) },
  ];
  return (
    <>
      <PageHeader title="External evaluators" subtitle="Temporary, limited access for evaluators from outside the university." actions={<Button icon={Plus} onClick={() => setInvite(true)}>Invite evaluator</Button>} />
      <DataTable columns={cols} rows={state.data} loading={state.loading} error={state.error} onRetry={state.reload} minWidth={760} />
      {invite && <InviteForm onClose={() => setInvite(false)} onSaved={(c) => { setInvite(false); setCreated(c); state.reload(); }} />}
      {created && <Modal title="Evaluator access created" onClose={() => setCreated(null)} footer={<Button onClick={() => setCreated(null)}>Done</Button>}>
        {created.password ? <><Alert tone="warning" className="mb">Share these login details securely. The password is shown only once and must be changed at first login.</Alert>
          <p>Email: <strong>{created.email}</strong></p><div className="row"><code style={{ fontSize: 18, padding: '6px 10px', background: 'var(--hover)', borderRadius: 6 }}>{created.password}</code><Button size="sm" variant="secondary" icon={Copy} onClick={() => { navigator.clipboard?.writeText(created.password); toast.success('Copied'); }}>Copy</Button></div></>
          : <p>{created.email} already had an evaluator account, so the new projects were added to it. Their existing password is unchanged.</p>}
      </Modal>}
      {revoke && <ConfirmDialog danger title="Revoke access?" confirmLabel="Revoke" loading={busy} message={`${revoke.evaluator?.name} will lose access immediately. Evaluations already submitted are kept.`} onClose={() => setRevoke(null)} onConfirm={() => run(() => post(`/external-evaluators/${revoke._id}/revoke`), 'Access revoked')} />}
      {extend && <Modal title="Extend access" onClose={() => setExtend(null)} footer={<><Button variant="secondary" onClick={() => setExtend(null)}>Cancel</Button><Button loading={busy} onClick={() => run(() => patch(`/external-evaluators/${extend._id}/extend`, { expiresAt: endOfDay(date) }), 'Access extended')}>Extend</Button></>}>
        <Field label={`New expiry for ${extend.evaluator?.name}`}><Input type="date" min={inDays(1)} value={date} onChange={(e) => setDate(e.target.value)} /></Field></Modal>}
    </>
  );
}
