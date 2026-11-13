import { useState } from 'react';
import { Bell, Check as CheckIcon, Megaphone, Save, Send, X } from 'lucide-react';
import { Alert, Badge, Button, Card, CardBody, CardHead, ErrorState, KV, Loading, PageHeader } from '../../components/common/ui.jsx';
import DataTable from '../../components/tables/DataTable.jsx';
import { ConfirmDialog } from '../../components/common/Modal.jsx';
import { Check, Field, Input, Select, TextArea } from '../../components/forms/fields.jsx';
import { usePaged } from '../../hooks/usePaged.js';
import { useAsync } from '../../hooks/useAsync.js';
import { useForm } from '../../hooks/useForm.js';
import { useToast } from '../../context/ToastContext.jsx';
import { errMsg, get, post, put } from '../../services/api.js';
import { fmtBytes, fmtDate, fmtDateTime, timeAgo } from '../../utils/format.js';
import Hint from '../../components/onboarding/Hint.jsx';

// ---------------------------------------------------------------- announcements
export function AnnouncementsPage() {
  const toast = useToast();
  const list = usePaged('/announcements', { limit: 10 });
  const deps = useAsync(() => Promise.all([get('/departments'), get('/academic-terms')]), []);
  const f = useForm({ title: '', body: '', roles: ['student', 'supervisor'], departments: [], terms: [] });
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [departments, terms] = deps.data || [[], []];
  const toggle = (k, id) => f.set(k, f.values[k].includes(id) ? f.values[k].filter((x) => x !== id) : [...f.values[k], id]);
  const send = async () => {
    setBusy(true);
    try { const a = await post('/announcements', f.values); toast.success(`Sent to ${a.recipientCount} users`); f.reset(); setConfirm(false); list.reload(); }
    catch (e) { f.applyError(e); toast.error(errMsg(e)); setConfirm(false); } finally { setBusy(false); }
  };
  const roleList = [['student', 'Students'], ['supervisor', 'Supervisors'], ['coordinator', 'Coordinators']];
  const cols = [
    { key: 't', header: 'Announcement', render: (a) => <><strong>{a.title}</strong><div className="muted small truncate" style={{ maxWidth: 360 }}>{a.body}</div></> },
    { key: 'r', header: 'Audience', render: (a) => (a.audience?.roles?.length ? a.audience.roles.join(', ') : 'Everyone') },
    { key: 'n', header: 'Recipients', render: (a) => a.recipientCount },
    { key: 'w', header: 'Sent', render: (a) => <>{fmtDateTime(a.createdAt)}<div className="muted small">{a.createdBy?.name}</div></> },
  ];
  return (
    <>
      <PageHeader title="Announcements" subtitle="Sent as in-app notifications to the chosen audience." />
      <div className="grid cols-2" style={{ alignItems: 'start' }}>
        <Card><CardHead title="New announcement" icon={Megaphone} /><CardBody className="stack">
          <Field label="Title" required error={f.errors.title}><Input {...f.bind('title')} maxLength={160} /></Field>
          <Field label="Message" required error={f.errors.body}><TextArea rows={5} {...f.bind('body')} maxLength={3000} /></Field>
          <div><strong className="small">Roles</strong><div className="row">{roleList.map(([k, l]) => <Check key={k} label={l} checked={f.values.roles.includes(k)} onChange={() => toggle('roles', k)} />)}</div></div>
          <Field label="Limit to departments" help="Leave all unticked for every department."><div className="row">{departments.map((d) => <Check key={d._id} label={d.code} checked={f.values.departments.includes(d._id)} onChange={() => toggle('departments', d._id)} />)}</div></Field>
          <Field label="Limit to terms" help="Leave all unticked for every term."><div className="row">{terms.map((t) => <Check key={t._id} label={t.name} checked={f.values.terms.includes(t._id)} onChange={() => toggle('terms', t._id)} />)}</div></Field>
          <div><Button icon={Send} disabled={!f.values.title.trim() || !f.values.body.trim() || !f.values.roles.length} onClick={() => setConfirm(true)}>Send announcement</Button></div>
        </CardBody></Card>
        <div><h2 className="section-title">History</h2><DataTable columns={cols} {...list} onPage={list.setPage} onRetry={list.reload} minWidth={420} /></div>
      </div>
      {confirm && <ConfirmDialog title="Send announcement?" confirmLabel="Send" loading={busy} onClose={() => setConfirm(false)} onConfirm={send} message={`"${f.values.title}" will be delivered immediately and cannot be recalled.`} />}
    </>
  );
}

// ---------------------------------------------------------------- roles matrix (read only)
const MATRIX = [
  ['Create / join group, manage members', 1, 0, 0, 0, 'Group Leader only for official actions'],
  ['Submit proposals and reports', 1, 0, 0, 0, 'Group Leader only'],
  ['View own project and results', 1, 1, 1, 0, 'Evaluators: assigned projects only'],
  ['Review proposals and reports', 0, 1, 1, 0, 'Supervisor: own projects'],
  ['Milestones, meetings, interaction logs', 1, 1, 1, 0, 'Students propose, supervisors approve'],
  ['Evaluate projects', 0, 1, 0, 1, 'Evaluators: only while access is active'],
  ['Manage users, departments, terms', 0, 0, 1, 0, ''],
  ['Assign supervisors', 0, 0, 1, 0, ''],
  ['Rubrics, publish results, re-open evaluations', 0, 0, 1, 0, ''],
  ['External evaluator access', 0, 0, 1, 0, ''],
  ['Analytics, exports, audit logs, settings', 0, 0, 1, 0, ''],
];
export function RolesPage() {
  const mark = (v) => (v ? <CheckIcon size={16} style={{ color: 'var(--success)' }} aria-label="Allowed" /> : <X size={16} style={{ color: 'var(--text-2, #64748B)' }} aria-label="Not allowed" />);
  return (
    <>
      <PageHeader title="Roles & permissions" subtitle="Read-only summary. Permissions are enforced on the server for every request." />
      <Alert className="mb">The Coordinator is also the system administrator. Roles are fixed in code so they cannot be edited by accident; ask a developer to change them.</Alert>
      <Card><div className="table-wrap"><table className="table" style={{ minWidth: 640 }}>
        <thead><tr><th>Capability</th><th>Student</th><th>Supervisor</th><th>Coordinator</th><th>Evaluator</th><th>Note</th></tr></thead>
        <tbody>{MATRIX.map((r) => <tr key={r[0]}><td>{r[0]}</td>{[1, 2, 3, 4].map((i) => <td key={i}>{mark(r[i])}</td>)}<td className="muted small">{r[5]}</td></tr>)}</tbody></table></div></Card>
    </>
  );
}

// ---------------------------------------------------------------- settings
export function SystemSettingsPage() {
  const toast = useToast();
  const state = useAsync(() => get('/settings'), []);
  const [vals, setVals] = useState(null);
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);
  if (state.loading && !state.data) return <Loading />;
  if (state.error && !state.data) return <ErrorState message={state.error} onRetry={state.reload} />;
  const { settings, rules } = state.data;
  const cur = vals || settings;
  const set = (k, v) => setVals({ ...cur, [k]: v });
  const save = async () => {
    setBusy(true);
    try { const r = await put('/settings', cur); state.setData(r); setVals(null); toast.success('Settings saved'); } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  const runReminders = async () => { setRunning(true); try { const r = await post('/notifications/run-reminders'); toast.success(`Reminders checked (${r.sent ?? 0} sent)`); } catch (e) { toast.error(errMsg(e)); } finally { setRunning(false); } };
  return (
    <>
      <PageHeader title="System settings" subtitle="Academic rules used across the whole system." />
      <Hint id="coordinator.settings" />
      <Card><CardBody className="stack">
        {Object.entries(rules).map(([k, r]) => r.type === 'bool'
          ? <Check key={k} label={r.label} checked={!!cur[k]} onChange={(e) => set(k, e.target.checked)} />
          : <Field key={k} label={r.label} help={`Between ${r.min} and ${r.max}`}><Input type="number" min={r.min} max={r.max} value={cur[k]} onChange={(e) => set(k, e.target.value)} style={{ maxWidth: 140 }} /></Field>)}
        <div><Button icon={Save} loading={busy} disabled={!vals} onClick={save}>Save settings</Button></div>
      </CardBody></Card>
      <Card className="mt"><CardHead title="Deadline reminders" icon={Bell} /><CardBody>
        <p className="muted" style={{ marginTop: 0 }}>Reminders for upcoming milestones, meetings and report deadlines are checked every hour. You can run the check now; duplicates are never sent twice.</p>
        <Button variant="secondary" loading={running} onClick={runReminders}>Run reminder check now</Button></CardBody></Card>
    </>
  );
}

// ---------------------------------------------------------------- backup / maintenance
export function SystemInfoPage() {
  const state = useAsync(() => get('/system/info'), []);
  if (state.loading && !state.data) return <Loading />;
  if (state.error && !state.data) return <ErrorState message={state.error} onRetry={state.reload} />;
  const d = state.data;
  return (
    <>
      <PageHeader title="Backup & maintenance" subtitle="Health information and how to back up. Backups are manual." />
      <div className="grid cols-2" style={{ alignItems: 'start' }}>
        <Card><CardHead title="System" /><CardBody><KV items={[['Environment', d.environment], ['Node.js', d.node], ['Database', d.database.name ? `${d.database.state} - ${d.database.name} @ ${d.database.host}` : d.database.state], ['Uploaded files', d.uploads.bytes != null ? `${fmtBytes(d.uploads.bytes)} (limit ${d.uploads.maxUploadMB} MB per file)` : `limit ${d.uploads.maxUploadMB} MB per file`], ['Uptime', `${Math.floor(d.uptimeSeconds / 3600)}h ${Math.floor((d.uptimeSeconds % 3600) / 60)}m`]]} /></CardBody></Card>
        <Card><CardHead title="Records" /><CardBody><KV items={Object.entries(d.collections).map(([k, v]) => [k, v])} /></CardBody></Card>
      </div>
      <Card className="mt"><CardHead title="How to back up" /><CardBody className="stack-sm">{d.backupAdvice.map((l) => <div key={l} className={l.includes('mongo') ? '' : 'muted'}>{l.includes('mongo') ? <code>{l}</code> : l}</div>)}</CardBody></Card>
    </>
  );
}

// ---------------------------------------------------------------- audit logs
export function AuditLogsPage() {
  const list = usePaged('/audit-logs', { limit: 25 });
  const cols = [
    { key: 'w', header: 'When', render: (a) => <>{fmtDateTime(a.createdAt)}<div className="muted small">{timeAgo(a.createdAt)}</div></> },
    { key: 'u', header: 'Who', render: (a) => (a.actor ? <>{a.actor.name}<div className="muted small">{a.actor.role}</div></> : 'System') },
    { key: 'a', header: 'Action', render: (a) => <Badge tone="info">{a.action}</Badge> },
    { key: 's', header: 'Details', render: (a) => a.summary },
  ];
  return (
    <>
      <PageHeader title="Audit logs" subtitle="Who changed what. Entries cannot be edited or deleted from the application." />
      <Card className="mb"><CardBody className="row">
        <Input aria-label="Search details" placeholder="Search details" value={list.q} onChange={(e) => list.setQ(e.target.value)} style={{ maxWidth: 260 }} />
        <Input aria-label="Action starts with" placeholder="Action, e.g. user." value={list.filters.action || ''} onChange={(e) => list.setFilter('action', e.target.value)} style={{ maxWidth: 200 }} />
        <Input aria-label="From date" type="date" value={list.filters.from || ''} onChange={(e) => list.setFilter('from', e.target.value)} style={{ maxWidth: 160 }} />
        <Input aria-label="To date" type="date" value={list.filters.to || ''} onChange={(e) => list.setFilter('to', e.target.value)} style={{ maxWidth: 160 }} />
      </CardBody></Card>
      <DataTable columns={cols} {...list} onPage={list.setPage} onRetry={list.reload} minWidth={640} />
    </>
  );
}
