import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus, RefreshCw, Save } from 'lucide-react';
import { Alert, Badge, Button, Card, CardBody, CardHead, ErrorState, KV, Loading, PageHeader } from '../../components/common/ui.jsx';
import { Modal } from '../../components/common/Modal.jsx';
import DataTable from '../../components/tables/DataTable.jsx';
import { Check, Field, Input, SearchInput, Select, TextArea } from '../../components/forms/fields.jsx';
import PasswordInput from '../../components/forms/PasswordInput.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { useForm } from '../../hooks/useForm.js';
import { usePaged } from '../../hooks/usePaged.js';
import { useToast } from '../../context/ToastContext.jsx';
import { usePlatformAuth } from '../../context/PlatformAuthContext.jsx';
import { errMsg, get, patch, post, put } from '../../services/api.js';
import { fmtBytes, fmtDateTime, timeAgo } from '../../utils/format.js';
import { CoordinatorActions, CoordinatorBadges, STATUS_LABEL, TempPasswordDialog } from './platformShared.jsx';

export function PlatformCoordinators() {
  const [sp] = useSearchParams();
  const p = usePaged('/platform/coordinators', { initialFilters: { state: sp.get('state') || '' }, limit: 20 });
  const columns = [
    { key: 'name', header: 'Coordinator', render: (c) => <><strong>{c.name}</strong><div className="muted small">{c.email}</div></> },
    { key: 'inst', header: 'Institution', render: (c) => c.institution ? <><Link to={`/platform/institutions/${c.institution._id}`}>{c.institution.name}</Link><div className="muted small">{STATUS_LABEL[c.institution.status] || c.institution.status}</div></> : '-' },
    { key: 'state', header: 'State', render: (c) => <CoordinatorBadges c={c} /> },
    { key: 'login', header: 'Last login', render: (c) => <span className="small">{c.lastLoginAt ? timeAgo(c.lastLoginAt) : 'never'}</span> },
    { key: 'act', header: 'Help', render: (c) => <CoordinatorActions c={c} onDone={p.reload} /> },
  ];
  return (
    <>
      <PageHeader title="Coordinators" subtitle="Account-level help for institution coordinators: reset a password, switch an account off, resend or confirm the verification email." />
      <Card className="mb"><CardBody className="row wrap">
        <SearchInput value={p.q} onChange={p.setQ} placeholder="Search name or email..." />
        <Select aria-label="Filter" value={p.filters.state} onChange={(e) => p.setFilter('state', e.target.value)} style={{ width: 210 }}>
          <option value="">All coordinators</option><option value="unverified">Email not verified</option><option value="inactive">Inactive</option>
        </Select>
      </CardBody></Card>
      <DataTable columns={columns} rows={p.rows} loading={p.loading} error={p.error} onRetry={p.reload} meta={p.meta} onPage={p.setPage} minWidth={820} />
    </>
  );
}

function AddAdminDialog({ onClose, onCreated }) {
  const toast = useToast();
  const f = useForm({ name: '', email: '' });
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try { onCreated(await post('/platform/admins', { name: f.values.name.trim(), email: f.values.email.trim() })); }
    catch (err) { f.applyError(err); toast.error(errMsg(err)); } finally { setBusy(false); }
  };
  return (
    <Modal title="Add a platform admin" onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="add-admin" loading={busy}>Create admin</Button></>}>
      <form id="add-admin" className="stack" onSubmit={submit}>
        <Alert tone="warning">A platform admin can suspend or erase any institution and manage all coordinators. Only add people you fully trust.</Alert>
        <Field label="Name" required error={f.errors.name}><Input {...f.bind('name')} required /></Field>
        <Field label="Email" required error={f.errors.email} help="Must not be used by any institution account."><Input type="email" {...f.bind('email')} required /></Field>
      </form>
    </Modal>
  );
}

export function PlatformAdmins() {
  const { admin: me } = usePlatformAuth();
  const toast = useToast();
  const list = useAsync(() => get('/platform/admins'), []);
  const [adding, setAdding] = useState(false);
  const [temp, setTemp] = useState(null);
  const [confirm, setConfirm] = useState(null); // { a, action }
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const r = await post(`/platform/admins/${confirm.a._id}/action`, { action: confirm.action });
      if (confirm.action === 'reset-password') setTemp({ email: confirm.a.email, password: r.tempPassword, emailed: r.emailed });
      else toast.success('Done');
      setConfirm(null); list.reload();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  const TEXT = { deactivate: 'They are logged out at once and cannot log in until you reactivate them.', reactivate: 'They can log in again.', 'reset-password': 'A new temporary password is created and shown to you once; their sessions end.' };
  const columns = [
    { key: 'name', header: 'Admin', render: (a) => <><strong>{a.name}</strong> {a._id === me._id && <Badge tone="info">you</Badge>} {a.isFounder && <Badge tone="neutral">founder</Badge>}<div className="muted small">{a.email}</div></> },
    { key: 'state', header: 'State', render: (a) => <span className="row" style={{ gap: 4 }}>{a.isActive ? <Badge tone="success">active</Badge> : <Badge tone="danger">inactive</Badge>}{a.mustChangePassword && <Badge tone="warning">has not set own password</Badge>}</span> },
    { key: 'login', header: 'Last login', render: (a) => <span className="small">{a.lastLoginAt ? timeAgo(a.lastLoginAt) : 'never'}</span> },
    { key: 'act', header: '', render: (a) => a._id === me._id || a.isFounder ? <span className="muted small">{a._id === me._id ? 'Use My account' : 'Protected'}</span> : (
      <span className="row" style={{ gap: 2 }}>
        <Button size="sm" variant="ghost" onClick={() => setConfirm({ a, action: 'reset-password' })}>Reset password</Button>
        {a.isActive ? <Button size="sm" variant="ghost" onClick={() => setConfirm({ a, action: 'deactivate' })}>Deactivate</Button> : <Button size="sm" variant="ghost" onClick={() => setConfirm({ a, action: 'reactivate' })}>Reactivate</Button>}
      </span>) },
  ];
  return (
    <>
      <PageHeader title="Platform admins" subtitle="The people who run this website. Admins belong to no institution and sign in from the Login page > Platform admin." actions={<Button icon={Plus} onClick={() => setAdding(true)}>Add admin</Button>} />
      <DataTable columns={columns} rows={list.data} loading={list.loading} error={list.error} onRetry={list.reload} minWidth={640} />
      {adding && <AddAdminDialog onClose={() => setAdding(false)} onCreated={(r) => { setAdding(false); setTemp({ email: r.admin.email, password: r.tempPassword, emailed: r.emailed }); list.reload(); }} />}
      {temp && <TempPasswordDialog title="Temporary password for the admin" email={temp.email} password={temp.password} emailed={temp.emailed} onClose={() => setTemp(null)} />}
      {confirm && (
        <Modal title={`${confirm.action === 'reset-password' ? 'Reset password' : confirm.action === 'deactivate' ? 'Deactivate' : 'Reactivate'}: ${confirm.a.name}?`} onClose={() => setConfirm(null)} footer={<><Button variant="secondary" onClick={() => setConfirm(null)}>Cancel</Button><Button variant={confirm.action === 'deactivate' ? 'danger' : 'primary'} loading={busy} onClick={run}>Confirm</Button></>}>
          <p style={{ margin: 0 }} className="muted">{TEXT[confirm.action]}</p>
        </Modal>
      )}
    </>
  );
}

export function PlatformAudit() {
  const p = usePaged('/platform/audit', { limit: 30, initialFilters: { action: '' } });
  const columns = [
    { key: 'when', header: 'When', render: (a) => <span className="small">{fmtDateTime(a.createdAt)}</span> },
    { key: 'who', header: 'Admin', render: (a) => a.actorName || '-' },
    { key: 'action', header: 'Action', render: (a) => <code className="small">{a.action}</code> },
    { key: 'summary', header: 'What happened', render: (a) => a.summary },
    { key: 'ip', header: 'IP', render: (a) => <span className="muted small">{a.ip || '-'}</span> },
  ];
  return (
    <>
      <PageHeader title="Platform audit log" subtitle="Every admin action on this console: who did what, and when." />
      <Card className="mb"><CardBody className="row wrap">
        <SearchInput value={p.q} onChange={p.setQ} placeholder="Search the log..." />
        <Select aria-label="Type" value={p.filters.action} onChange={(e) => p.setFilter('action', e.target.value)} style={{ width: 200 }}>
          <option value="">All actions</option><option value="institution">Institutions</option><option value="coordinator">Coordinators</option><option value="admin">Admins</option><option value="platform">Settings</option>
        </Select>
      </CardBody></Card>
      <DataTable columns={columns} rows={p.rows} loading={p.loading} error={p.error} onRetry={p.reload} meta={p.meta} onPage={p.setPage} minWidth={760} />
    </>
  );
}

const fmtUptime = (s) => { const d = Math.floor(s / 86400); const h = Math.floor((s % 86400) / 3600); const m = Math.floor((s % 3600) / 60); return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`; };

export function PlatformHealth() {
  const state = useAsync(() => get('/platform/health'), []);
  if (state.loading && !state.data) return <Loading />;
  if (state.error) return <ErrorState message={state.error} onRetry={state.reload} />;
  const h = state.data;
  return (
    <>
      <PageHeader title="System health" subtitle="Is the website running properly? Nothing secret is shown here." actions={<Button variant="secondary" icon={RefreshCw} loading={state.loading} onClick={state.reload}>Refresh</Button>} />
      <div className="stack mb">
        {h.status !== 'ok' && <Alert tone="danger">The database is not connected right now.</Alert>}
        {!h.email.configured && <Alert tone="warning"><strong>Email is not configured.</strong> Verification and password-reset emails cannot be sent, so new users cannot verify their accounts. Set the SMTP variables on the server.</Alert>}
        {!h.setupCodeConfigured && <Alert tone="info">No PLATFORM_SETUP_CODE is set. That is fine now that an admin exists, but set one so the setup page stays locked if the database is ever emptied.</Alert>}
        {h.persistentStorageWarning && <Alert tone="warning">{h.persistentStorageWarning}</Alert>}
      </div>
      <div className="grid cols-2" style={{ alignItems: 'start' }}>
        <Card><CardHead title="Server" /><CardBody><KV items={[['Status', h.status === 'ok' ? 'Running' : 'Problem'], ['Environment', h.server.environment], ['Node', h.server.node], ['Running for', fmtUptime(h.server.uptimeSeconds)], ['Memory', `${h.server.memoryMB} MB`], ['Server time', fmtDateTime(h.server.time)], ['Website address', h.appUrl]]} /></CardBody></Card>
        <Card><CardHead title="Database, email and files" /><CardBody><KV items={[['Database', h.database.state], ['Database name', h.database.name], ['Email sending', h.email.configured ? `Configured (from ${h.email.from})` : 'Not configured'], ['Uploaded files', `${h.uploads.files} files, ${fmtBytes(h.uploads.bytes)}`], ['Deleted institutions erased after', `${h.purgeDays} days`]]} /></CardBody></Card>
      </div>
    </>
  );
}

export function PlatformSettings() {
  const toast = useToast();
  const state = useAsync(() => get('/platform/settings'), []);
  const [v, setV] = useState(null);
  const [busy, setBusy] = useState(false);
  if (state.loading && !state.data) return <Loading />;
  if (state.error) return <ErrorState message={state.error} onRetry={state.reload} />;
  const cur = v || state.data;
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try { const r = await put('/platform/settings', cur); state.setData(r); setV(null); toast.success('Settings saved'); } catch (err) { toast.error(errMsg(err)); } finally { setBusy(false); }
  };
  return (
    <>
      <PageHeader title="Platform settings" subtitle="Switches that apply to the whole website." />
      <Card><CardBody>
        <form className="stack" onSubmit={save} style={{ maxWidth: 560 }}>
          <Check label="Allow new institutions to sign up on the Register page" checked={cur.allowInstitutionRegistration} onChange={(e) => setV({ ...cur, allowInstitutionRegistration: e.target.checked })} />
          <p className="muted small" style={{ margin: 0 }}>Switch this off to stop strangers from creating institutions (for example while you only add institutions yourself). Students and supervisors can still join institutions that already exist.</p>
          <Field label="Message on the login page (optional)" help="For example: Maintenance on Sunday 10 pm. Leave empty for no message."><TextArea rows={2} maxLength={240} value={cur.loginNotice || ''} onChange={(e) => setV({ ...cur, loginNotice: e.target.value })} /></Field>
          <div><Button type="submit" icon={Save} loading={busy} disabled={!v}>Save settings</Button></div>
        </form>
      </CardBody></Card>
    </>
  );
}

export function PlatformAccount() {
  const { admin, setAdmin } = usePlatformAuth();
  const toast = useToast();
  const prof = useForm({ name: admin.name });
  const pw = useForm({ currentPassword: '', newPassword: '', confirm: '' });
  const [busy, setBusy] = useState('');
  const mismatch = pw.values.confirm && pw.values.newPassword !== pw.values.confirm;
  const saveName = async (e) => {
    e.preventDefault(); setBusy('name');
    try { const r = await patch('/platform/auth/me', { name: prof.values.name.trim() }); setAdmin(r.admin); toast.success('Saved'); } catch (err) { prof.applyError(err); toast.error(errMsg(err)); } finally { setBusy(''); }
  };
  const savePw = async (e) => {
    e.preventDefault(); setBusy('pw');
    try { const r = await post('/platform/auth/change-password', { currentPassword: pw.values.currentPassword, newPassword: pw.values.newPassword }); setAdmin(r.admin); pw.reset(); toast.success('Password changed. Your other sessions were logged out.'); } catch (err) { pw.applyError(err); toast.error(errMsg(err)); } finally { setBusy(''); }
  };
  return (
    <>
      <PageHeader title="My account" subtitle={admin.email} />
      <div className="grid cols-2" style={{ alignItems: 'start' }}>
        <Card><CardHead title="Profile" /><CardBody>
          <form className="stack" onSubmit={saveName}>
            <Field label="Name" required error={prof.errors.name}><Input {...prof.bind('name')} required minLength={2} /></Field>
            <div><Button type="submit" icon={Save} loading={busy === 'name'}>Save</Button></div>
            <p className="muted small" style={{ margin: 0 }}>Last login: {admin.lastLoginAt ? fmtDateTime(admin.lastLoginAt) : '-'}{admin.isFounder ? ' - you are the founding admin' : ''}</p>
          </form>
        </CardBody></Card>
        <Card><CardHead title="Change password" /><CardBody>
          <form className="stack" onSubmit={savePw}>
            <Field label="Current password" required error={pw.errors.currentPassword}><PasswordInput {...pw.bind('currentPassword')} autoComplete="current-password" required /></Field>
            <Field label="New password" required error={pw.errors.newPassword} help="At least 8 characters with a letter and a number."><PasswordInput {...pw.bind('newPassword')} autoComplete="new-password" required /></Field>
            <Field label="Confirm new password" required error={mismatch ? 'Passwords do not match' : undefined}><PasswordInput {...pw.bind('confirm')} autoComplete="new-password" required /></Field>
            <div><Button type="submit" loading={busy === 'pw'} disabled={mismatch || !pw.values.newPassword}>Change password</Button></div>
          </form>
        </CardBody></Card>
      </div>
    </>
  );
}
