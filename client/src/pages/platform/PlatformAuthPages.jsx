import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { KeyRound, LogOut, ShieldCheck } from 'lucide-react';
import AuthShell from '../auth/AuthShell.jsx';
import { Alert, Button, Loading } from '../../components/common/ui.jsx';
import { Field, Input } from '../../components/forms/fields.jsx';
import PasswordInput from '../../components/forms/PasswordInput.jsx';
import { usePlatformAuth } from '../../context/PlatformAuthContext.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { useForm } from '../../hooks/useForm.js';
import { errMsg, get, post } from '../../services/api.js';

/** /platform/setup - creates the very first platform admin. Works only while no admin exists. */
export function PlatformSetup() {
  const { admin, setup } = usePlatformAuth();
  const navigate = useNavigate();
  const status = useAsync(() => get('/platform/setup-status'), []);
  const f = useForm({ name: '', email: '', password: '', confirm: '', setupCode: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (admin) return <Navigate to="/platform" replace />;
  const s = status.data;
  const mismatch = f.values.confirm && f.values.password !== f.values.confirm;

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      await setup({ name: f.values.name.trim(), email: f.values.email.trim(), password: f.values.password, setupCode: s?.needsCode ? f.values.setupCode : undefined });
      navigate('/platform', { replace: true });
    } catch (err) { f.applyError(err); setError(errMsg(err)); } finally { setBusy(false); }
  };

  return (
    <AuthShell>
      <h1>Set up the platform</h1>
      {status.loading && !s ? <Loading /> : status.error ? <Alert tone="danger">{status.error}</Alert> : s && !s.needsSetup ? (
        <>
          <Alert tone="info" className="mb">The platform is already set up. Ask an existing admin to add you, or log in.</Alert>
          <Button to="/login" block>Go to log in</Button>
        </>
      ) : (
        <>
          <p className="muted mb">Create the <strong>first platform admin account</strong>. This is the website owner: it manages institutions and coordinators from a separate admin console, and belongs to no university. You can add more admins afterwards.</p>
          {error && <Alert tone="danger" className="mb">{error}</Alert>}
          <form className="stack" onSubmit={submit} noValidate>
            <Field label="Your name" required error={f.errors.name}><Input {...f.bind('name')} autoComplete="name" required autoFocus /></Field>
            <Field label="Email" required error={f.errors.email}><Input type="email" {...f.bind('email')} autoComplete="username" required /></Field>
            <Field label="Password" required error={f.errors.password} help="At least 8 characters with a letter and a number."><PasswordInput {...f.bind('password')} autoComplete="new-password" required /></Field>
            <Field label="Confirm password" required error={mismatch ? 'Passwords do not match' : undefined}><PasswordInput {...f.bind('confirm')} autoComplete="new-password" required /></Field>
            {s?.needsCode && (
              <Field label="Setup code" required error={f.errors.setupCode} help={s.codeConfigured ? 'The secret PLATFORM_SETUP_CODE you set on the server (your hosting settings).' : 'Not set yet: add PLATFORM_SETUP_CODE=your-secret in your hosting environment variables, restart, then come back.'}>
                <PasswordInput {...f.bind('setupCode')} autoComplete="off" required />
              </Field>
            )}
            <Button type="submit" icon={ShieldCheck} loading={busy} block disabled={mismatch || !f.values.name || !f.values.email || !f.values.password}>Create the admin account</Button>
          </form>
        </>
      )}
      <p className="small mt center"><Link to="/login">Back to log in</Link></p>
    </AuthShell>
  );
}

/** Shown when another admin gave this admin a temporary password. */
export function PlatformChangePassword() {
  const { admin, setAdmin, logout } = usePlatformAuth();
  const navigate = useNavigate();
  const f = useForm({ currentPassword: '', newPassword: '', confirm: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (!admin) return <Navigate to="/login" replace state={{ role: 'platform' }} />;
  if (!admin.mustChangePassword) return <Navigate to="/platform" replace />;
  const mismatch = f.values.confirm && f.values.newPassword !== f.values.confirm;
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const r = await post('/platform/auth/change-password', { currentPassword: f.values.currentPassword, newPassword: f.values.newPassword });
      setAdmin(r.admin);
      navigate('/platform', { replace: true });
    } catch (err) { f.applyError(err); setError(errMsg(err)); } finally { setBusy(false); }
  };
  return (
    <AuthShell>
      <h1>Set your own password</h1>
      <p className="muted mb">You signed in with a temporary password. Choose a new one to continue.</p>
      {error && <Alert tone="danger" className="mb">{error}</Alert>}
      <form className="stack" onSubmit={submit}>
        <Field label="Temporary password" required error={f.errors.currentPassword}><Input type="password" {...f.bind('currentPassword')} autoComplete="current-password" required /></Field>
        <Field label="New password" required error={f.errors.newPassword} help="At least 8 characters with a letter and a number."><Input type="password" {...f.bind('newPassword')} autoComplete="new-password" required /></Field>
        <Field label="Confirm new password" required error={mismatch ? 'Passwords do not match' : undefined}><Input type="password" {...f.bind('confirm')} autoComplete="new-password" required /></Field>
        <Button type="submit" icon={KeyRound} loading={busy} block disabled={mismatch}>Save and continue</Button>
        <Button variant="ghost" icon={LogOut} block onClick={async () => { await logout(); navigate('/login', { state: { role: 'platform' } }); }}>Log out</Button>
      </form>
    </AuthShell>
  );
}
