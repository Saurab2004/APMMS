import { useState } from 'react';
import { Save, KeyRound, Trash2 } from 'lucide-react';
import { Modal } from '../../components/common/Modal.jsx';
import { Alert, Button, Card, CardBody, CardHead, KV, PageHeader, StatusBadge } from '../../components/common/ui.jsx';
import { Field, Input, TextArea, Check } from '../../components/forms/fields.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { useForm } from '../../hooks/useForm.js';
import { errMsg, patch, post } from '../../services/api.js';
import { fmtDate, fmtDateTime } from '../../utils/format.js';

export function ProfileForm() {
  const { user, setUser } = useAuth();
  const toast = useToast();
  const f = useForm({ name: user.name || '', phone: user.phone || '', bio: user.bio || '', designation: user.designation || '', expertise: (user.expertise || []).join(', ') });
  const [busy, setBusy] = useState(false);
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const body = { name: f.values.name, phone: f.values.phone, bio: f.values.bio };
      if (user.role === 'supervisor') { body.designation = f.values.designation; body.expertise = f.values.expertise.split(',').map((s) => s.trim()).filter(Boolean); }
      const r = await patch('/auth/profile', body);
      setUser(r.user);
      toast.success('Profile saved');
    } catch (err) { f.applyError(err); toast.error(errMsg(err)); } finally { setBusy(false); }
  };
  return (
    <div className="grid cols-2" style={{ alignItems: 'start' }}>
      <Card>
        <CardHead title="Personal details" />
        <CardBody>
          <form className="stack" onSubmit={save}>
            <Field label="Full name" required error={f.errors.name}><Input {...f.bind('name')} required /></Field>
            <Field label="Phone" error={f.errors.phone}><Input {...f.bind('phone')} autoComplete="tel" /></Field>
            {user.role === 'supervisor' && <>
              <Field label="Designation"><Input {...f.bind('designation')} /></Field>
              <Field label="Areas of expertise" help="Separate with commas"><Input {...f.bind('expertise')} /></Field>
            </>}
            <Field label="About me" error={f.errors.bio}><TextArea {...f.bind('bio')} maxLength={600} /></Field>
            <div><Button type="submit" icon={Save} loading={busy}>Save changes</Button></div>
          </form>
        </CardBody>
      </Card>
      <Card>
        <CardHead title="Account" />
        <CardBody>
          <KV items={[
            ['Email', user.email], ['Role', <StatusBadge key="r" status={user.role} />],
            user.studentId && ['Student ID', user.studentId],
            user.department && ['Department', user.department.name],
            user.term && ['Intake term', user.term.name],
            user.organization && ['Organization', user.organization],
            user.accessExpiresAt && ['Access expires', fmtDateTime(user.accessExpiresAt)],
            ['Member since', fmtDate(user.createdAt)], ['Last login', fmtDateTime(user.lastLoginAt)],
          ]} />
          <p className="muted small mt">Email, role, department and student ID can only be changed by the coordinator.</p>
        </CardBody>
      </Card>
    </div>
  );
}

export function PreferencesForm() {
  const { user, setUser } = useAuth();
  const toast = useToast();
  const [prefs, setPrefs] = useState({ chat: true, feedback: true, deadlines: true, ...(user.notificationPrefs || {}) });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try { const r = await patch('/auth/profile', { notificationPrefs: prefs }); setUser(r.user); toast.success('Preferences saved'); } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  if (user.role === 'evaluator') return null;
  return (
    <Card>
      <CardHead title="Notification preferences" />
      <CardBody className="stack">
        <p className="muted small" style={{ margin: 0 }}>Important notices (reviews, assignments, announcements) are always delivered.</p>
        <Check label="New chat messages" checked={prefs.chat} onChange={(e) => setPrefs({ ...prefs, chat: e.target.checked })} />
        <Check label="Feedback and discussion replies" checked={prefs.feedback} onChange={(e) => setPrefs({ ...prefs, feedback: e.target.checked })} />
        <Check label="Deadline and meeting reminders" checked={prefs.deadlines} onChange={(e) => setPrefs({ ...prefs, deadlines: e.target.checked })} />
        <div><Button icon={Save} loading={busy} onClick={save}>Save preferences</Button></div>
      </CardBody>
    </Card>
  );
}

export function PasswordForm() {
  const toast = useToast();
  const f = useForm({ currentPassword: '', newPassword: '', confirm: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const mismatch = f.values.confirm && f.values.newPassword !== f.values.confirm;
  const save = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try { await post('/auth/change-password', { currentPassword: f.values.currentPassword, newPassword: f.values.newPassword }); toast.success('Password changed'); f.reset(); } catch (err) { f.applyError(err); setError(errMsg(err)); } finally { setBusy(false); }
  };
  return (
    <Card>
      <CardHead title="Change password" />
      <CardBody>
        {error && <Alert tone="danger" className="mb">{error}</Alert>}
        <form className="stack" onSubmit={save} style={{ maxWidth: 420 }}>
          <Field label="Current password" required error={f.errors.currentPassword}><Input type="password" {...f.bind('currentPassword')} autoComplete="current-password" required /></Field>
          <Field label="New password" required error={f.errors.newPassword} help="At least 8 characters with a letter and a number."><Input type="password" {...f.bind('newPassword')} autoComplete="new-password" required /></Field>
          <Field label="Confirm new password" required error={mismatch ? 'Passwords do not match' : undefined}><Input type="password" {...f.bind('confirm')} autoComplete="new-password" required /></Field>
          <div><Button type="submit" icon={KeyRound} loading={busy} disabled={mismatch}>Update password</Button></div>
        </form>
      </CardBody>
    </Card>
  );
}

export const ProfilePage = () => (<><PageHeader title="My profile" subtitle="Your personal and academic information." /><ProfileForm /></>);
export const SettingsPage = () => (<><PageHeader title="Settings" subtitle="Notifications and security." /><div className="stack"><PreferencesForm /><PasswordForm /></div></>);
/** Coordinator only: removes the coordinator's own access. Records stay (soft delete). */
export function DeleteAccountCard() {
  const { user, setUser } = useAuth();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (user.role !== 'coordinator' || user.coordinatorLevel === 'department') return null;
  const close = () => { setOpen(false); setPassword(''); setConfirmText(''); setError(''); };
  const submit = async () => {
    setBusy(true); setError('');
    try {
      await post('/auth/delete-account', { password, confirmText });
      toast.success('Your account was deleted');
      setUser(null); // the server already ended the session
    } catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Card className="danger-zone">
      <CardHead title="Delete my account" icon={Trash2} />
      <CardBody className="stack">
        <p className="muted small">This removes <strong>your own</strong> coordinator account. It is permanent and cannot be undone. Projects, evaluations and the activity history are kept, but you will no longer be able to log in.</p>
        <div><Button variant="danger" icon={Trash2} onClick={() => setOpen(true)}>Delete my account</Button></div>
      </CardBody>
      {open && (
        <Modal title="Delete your account permanently?" onClose={close} footer={<><Button variant="secondary" onClick={close}>Cancel</Button><Button variant="danger" loading={busy} disabled={!password || confirmText.trim().toUpperCase() !== 'DELETE'} onClick={submit}>Permanently delete my account</Button></>}>
          <div className="stack">
            <Alert tone="danger">This cannot be undone. You will be logged out at once and your email address will be released.</Alert>
            <ul className="small" style={{ paddingLeft: 18, margin: 0 }}>
              <li>Academic records, projects, evaluations and the audit trail are <strong>not</strong> deleted.</li>
              <li>Your name stays on past records so history still makes sense.</li>
              <li>If you are the only active coordinator, deletion is blocked until another coordinator exists.</li>
            </ul>
            {error && <Alert tone="danger">{error}</Alert>}
            <Field label="Your password" required><Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
            <Field label="Type DELETE to confirm" required><Input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} autoComplete="off" /></Field>
          </div>
        </Modal>
      )}
    </Card>
  );
}

export const AccountPage = () => (<><PageHeader title="Profile & account" subtitle="Your details, notifications and password." /><div className="stack"><ProfileForm /><PreferencesForm /><PasswordForm /><DeleteAccountCard /></div></>);
