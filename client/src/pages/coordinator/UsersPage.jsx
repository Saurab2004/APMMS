import { useState } from 'react';
import { Check, Copy, KeyRound, MailCheck, Pencil, Plus, Power, X } from 'lucide-react';
import { Alert, Badge, Button, CardBody, Card, IconButton, PageHeader, StatusBadge } from '../../components/common/ui.jsx';
import DataTable from '../../components/tables/DataTable.jsx';
import { ConfirmDialog, Modal } from '../../components/common/Modal.jsx';
import { Field, Input, Select, SearchInput, TextArea } from '../../components/forms/fields.jsx';
import { usePaged } from '../../hooks/usePaged.js';
import { useAsync } from '../../hooks/useAsync.js';
import { useForm } from '../../hooks/useForm.js';
import { useToast } from '../../context/ToastContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { errMsg, get, getPaged, patch, post } from '../../services/api.js';
import { fmtDate, timeAgo } from '../../utils/format.js';
import Hint from '../../components/onboarding/Hint.jsx';

function TempPassword({ value, onClose, name }) {
  const toast = useToast();
  return (
    <Modal title="Temporary password" onClose={onClose} footer={<Button onClick={onClose}>Done</Button>}>
      <Alert tone="warning" className="mb">This password is shown only once. Share it securely with {name}; they must change it at first login.</Alert>
      <div className="row"><code style={{ fontSize: 18, padding: '6px 10px', background: 'var(--hover)', borderRadius: 6 }}>{value}</code>
        <Button size="sm" variant="secondary" icon={Copy} onClick={() => { navigator.clipboard?.writeText(value); toast.success('Copied'); }}>Copy</Button></div>
    </Modal>
  );
}

function UserForm({ user, departments, terms, onClose, onSaved }) {
  const editing = !!user;
  const f = useForm({ name: user?.name || '', email: user?.email || '', role: user?.role || 'student', departmentId: user?.department?._id || '', termId: user?.term || '', studentId: user?.studentId || '', phone: user?.phone || '', designation: user?.designation || '', maxProjects: user?.maxProjects || '' });
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const v = f.values;
  const submit = async (e) => {
    e.preventDefault(); setBusy(true);
    try {
      const body = { name: v.name, phone: v.phone, departmentId: v.departmentId || undefined, termId: v.termId || undefined, studentId: v.studentId || undefined, designation: v.designation || undefined, maxProjects: v.maxProjects ? Number(v.maxProjects) : undefined };
      const res = editing ? await patch(`/users/${user._id}`, body) : await post('/users', { ...body, email: v.email, role: v.role });
      toast.success(editing ? 'User updated' : 'Account created');
      onSaved(res.temporaryPassword ? { password: res.temporaryPassword, name: v.name } : null);
    } catch (err) { f.applyError(err); toast.error(errMsg(err)); } finally { setBusy(false); }
  };
  return (
    <Modal title={editing ? `Edit ${user.name}` : 'Create user'} onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={submit}>{editing ? 'Save changes' : 'Create account'}</Button></>}>
      <form className="stack" onSubmit={submit}>
        <Field label="Full name" required error={f.errors.name}><Input {...f.bind('name')} maxLength={120} required /></Field>
        <Field label="Email" required error={f.errors.email}><Input type="email" {...f.bind('email')} disabled={editing} required /></Field>
        {!editing && <Field label="Role" required error={f.errors.role}><Select {...f.bind('role')}><option value="student">Student</option><option value="supervisor">Supervisor</option><option value="coordinator">Coordinator</option></Select></Field>}
        {v.role !== 'coordinator' && <Field label="Department" required error={f.errors.departmentId}><Select {...f.bind('departmentId')}><option value="">Select...</option>{departments.map((d) => <option key={d._id} value={d._id}>{d.name}</option>)}</Select></Field>}
        {v.role === 'student' && <>
          <Field label="Student ID" required error={f.errors.studentId}><Input {...f.bind('studentId')} maxLength={30} /></Field>
          <Field label="Academic term" help="Defaults to the current term." error={f.errors.termId}><Select {...f.bind('termId')}><option value="">Current term</option>{terms.map((t) => <option key={t._id} value={t._id}>{t.name}</option>)}</Select></Field></>}
        {v.role === 'supervisor' && <>
          <Field label="Designation" error={f.errors.designation}><Input {...f.bind('designation')} maxLength={80} /></Field>
          <Field label="Maximum projects" error={f.errors.maxProjects}><Input type="number" min={1} max={50} {...f.bind('maxProjects')} /></Field></>}
        <Field label="Phone" error={f.errors.phone}><Input {...f.bind('phone')} maxLength={30} /></Field>
        {!editing && <p className="muted small" style={{ margin: 0 }}>A strong temporary password is generated and shown once after creation.</p>}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}


/** Supervisor sign-ups wait here until the coordinator decides. */
function PendingApprovals({ onChanged, refreshKey }) {
  const toast = useToast();
  const state = useAsync(() => getPaged('/users', { approval: 'pending', limit: 50 }), [refreshKey]);
  const [reject, setReject] = useState(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState('');
  const rows = state.data?.items || [];
  if (!rows.length) return null;
  const decide = async (u, decision) => {
    setBusy(u._id + decision);
    try { await post(`/users/${u._id}/approval`, { decision, note: decision === 'reject' ? note : undefined }); toast.success(decision === 'approve' ? `${u.name} approved` : `${u.name} rejected`); setReject(null); setNote(''); state.reload(); onChanged(); }
    catch (e) { toast.error(errMsg(e)); } finally { setBusy(''); }
  };
  return (
    <Card className="mb" style={{ borderColor: 'var(--warning)' }}>
      <CardBody>
        <h2 style={{ marginTop: 0 }}>Waiting for your approval ({rows.length})</h2>
        <ul className="list">{rows.map((u) => (
          <li key={u._id} className="row between">
            <span><strong>{u.name}</strong> <StatusBadge status={u.role} /><div className="muted small">{u.email} - {u.department?.name || 'No department'}{u.designation ? ` - ${u.designation}` : ''} - requested {timeAgo(u.createdAt)}</div></span>
            <span className="row"><Button size="sm" icon={Check} loading={busy === u._id + 'approve'} onClick={() => decide(u, 'approve')}>Approve</Button><Button size="sm" variant="secondary" icon={X} onClick={() => setReject(u)}>Reject</Button></span>
          </li>))}</ul>
      </CardBody>
      {reject && <Modal title={`Reject ${reject.name}?`} onClose={() => setReject(null)} footer={<><Button variant="secondary" onClick={() => setReject(null)}>Cancel</Button><Button variant="danger" loading={!!busy} onClick={() => decide(reject, 'reject')}>Reject request</Button></>}>
        <Field label="Reason (shown to the person when they try to log in)"><TextArea rows={3} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} /></Field></Modal>}
    </Card>
  );
}

export default function UsersPage() {
  const { user: me } = useAuth();
  const toast = useToast();
  const list = usePaged('/users', { initialSort: { key: 'createdAt', dir: 'desc' } });
  const deps = useAsync(() => Promise.all([get('/departments'), get('/academic-terms')]), []);
  const [form, setForm] = useState(null); // {user?}
  const [confirm, setConfirm] = useState(null); // {type,user}
  const [temp, setTemp] = useState(null);
  const [busy, setBusy] = useState(false);
  const [approvalKey, setApprovalKey] = useState(0);

  const act = async () => {
    setBusy(true);
    try {
      if (confirm.type === 'verify') { await post(`/users/${confirm.user._id}/mark-verified`); toast.success('Email marked as verified'); }
      else if (confirm.type === 'reset') { const r = await post(`/users/${confirm.user._id}/reset-password`); setTemp({ password: r.temporaryPassword, name: confirm.user.name }); }
      else { await patch(`/users/${confirm.user._id}/status`, { isActive: !confirm.user.isActive }); toast.success(confirm.user.isActive ? 'User deactivated' : 'User activated'); }
      setConfirm(null); list.reload();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };

  const [departments, terms] = deps.data || [[], []];
  const cols = [
    { key: 'name', header: 'Name', sortKey: 'name', render: (u) => <><strong>{u.name}</strong><div className="muted small">{u.email}</div></> },
    { key: 'role', header: 'Role', sortKey: 'role', render: (u) => <StatusBadge status={u.role} /> },
    { key: 'dept', header: 'Department', render: (u) => u.department?.code || '-' },
    { key: 'sid', header: 'Student ID', render: (u) => u.studentId || '-' },
    { key: 'active', header: 'Status', render: (u) => (u.deletedAt ? <StatusBadge status="inactive" label="Deleted" /> : u.emailVerified === false ? <div className="stack" style={{ gap: 4 }}>{u.approvalStatus === 'pending' ? <StatusBadge status="pending" label="Pending approval" /> : <StatusBadge status={u.isActive ? 'active' : 'inactive'} label={u.isActive ? 'Active' : 'Inactive'} />}<Badge tone="warning">Email not verified</Badge></div> : u.approvalStatus === 'pending' ? <StatusBadge status="pending" label="Pending approval" /> : u.approvalStatus === 'rejected' ? <StatusBadge status="rejected" /> : <StatusBadge status={u.isActive ? 'active' : 'inactive'} label={u.isActive ? 'Active' : 'Inactive'} />) },
    { key: 'last', header: 'Last login', sortKey: 'lastLoginAt', render: (u) => fmtDate(u.lastLoginAt) },
    { key: 'actions', header: 'Actions', render: (u) => (
      u.deletedAt ? <span className="muted small">Deleted by owner</span> : <div className="row" style={{ gap: 2, flexWrap: 'nowrap' }}>
        {u.emailVerified === false && <IconButton icon={MailCheck} label={`Mark ${u.name}'s email as verified`} onClick={() => setConfirm({ type: 'verify', user: u })} />}
        <IconButton icon={Pencil} label={`Edit ${u.name}`} onClick={() => setForm({ user: u })} />
        <IconButton icon={KeyRound} label={`Reset password for ${u.name}`} onClick={() => setConfirm({ type: 'reset', user: u })} />
        {u._id !== me._id && u.approvalStatus !== 'pending' && u.approvalStatus !== 'rejected' && <IconButton icon={Power} label={`${u.isActive ? 'Deactivate' : 'Activate'} ${u.name}`} onClick={() => setConfirm({ type: 'status', user: u })} />}
      </div>) },
  ];
  return (
    <>
      <PageHeader title="User management" subtitle="Accounts are deactivated, never deleted, so academic history stays intact." actions={<Button icon={Plus} onClick={() => setForm({})}>Create user</Button>} />
      <Hint id="coordinator.users" />
      <PendingApprovals refreshKey={approvalKey} onChanged={list.reload} />
      <Card className="mb"><CardBody className="row">
        <SearchInput value={list.q} onChange={list.setQ} placeholder="Search name, email or student ID" />
        <Select aria-label="Filter by role" value={list.filters.role || ''} onChange={(e) => list.setFilter('role', e.target.value)} style={{ width: 160 }}><option value="">All roles</option>{['student', 'supervisor', 'coordinator', 'evaluator'].map((r) => <option key={r} value={r}>{r[0].toUpperCase() + r.slice(1)}</option>)}</Select>
        <Select aria-label="Filter by department" value={list.filters.department || ''} onChange={(e) => list.setFilter('department', e.target.value)} style={{ width: 180 }}><option value="">All departments</option>{departments.map((d) => <option key={d._id} value={d._id}>{d.name}</option>)}</Select>
        <Select aria-label="Filter by status" value={list.filters.active || ''} onChange={(e) => list.setFilter('active', e.target.value)} style={{ width: 150 }}><option value="">Any status</option><option value="true">Active</option><option value="false">Inactive</option></Select>
      </CardBody></Card>
      <DataTable columns={cols} {...list} onPage={list.setPage} onRetry={list.reload} sort={list.sort} onSort={list.setSort} minWidth={760} />
      {form && <UserForm user={form.user} departments={departments} terms={terms} onClose={() => setForm(null)} onSaved={(t) => { setForm(null); setTemp(t); list.reload(); }} />}
      {confirm && <ConfirmDialog danger={confirm.type === 'reset' || (confirm.type === 'status' && confirm.user.isActive)} loading={busy} title={confirm.type === 'verify' ? 'Mark email as verified?' : confirm.type === 'reset' ? 'Reset password?' : confirm.user.isActive ? 'Deactivate user?' : 'Activate user?'} confirmLabel={confirm.type === 'verify' ? 'Mark as verified' : confirm.type === 'reset' ? 'Reset password' : confirm.user.isActive ? 'Deactivate' : 'Activate'} onClose={() => setConfirm(null)} onConfirm={act}
        message={confirm.type === 'verify' ? `Use this only if you know ${confirm.user.name} owns the address ${confirm.user.email} (for example when verification emails cannot be delivered). They will be able to log in without opening the email link.` : confirm.type === 'reset' ? `A new temporary password will be generated for ${confirm.user.name} and all their sessions will end.` : confirm.user.isActive ? `${confirm.user.name} will be signed out and unable to log in. Their records are kept.` : `${confirm.user.name} will be able to log in again.`} />}
      {temp && <TempPassword value={temp.password} name={temp.name} onClose={() => setTemp(null)} />}
    </>
  );
}
