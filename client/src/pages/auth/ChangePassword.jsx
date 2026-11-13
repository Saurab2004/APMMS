import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { KeyRound, LogOut } from 'lucide-react';
import AuthShell from './AuthShell.jsx';
import { Alert, Button } from '../../components/common/ui.jsx';
import { Field, Input } from '../../components/forms/fields.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { errMsg, post } from '../../services/api.js';
import { useForm } from '../../hooks/useForm.js';
import { homeFor } from '../../utils/format.js';

/** Shown when the coordinator gave the user a temporary password. */
export default function ChangePassword() {
  const { user, setUser, logout } = useAuth();
  const navigate = useNavigate();
  const f = useForm({ currentPassword: '', newPassword: '', confirm: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (!user) return <Navigate to="/login" replace />;
  if (!user.mustChangePassword) return <Navigate to={homeFor(user.role)} replace />;
  const mismatch = f.values.confirm && f.values.newPassword !== f.values.confirm;

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const r = await post('/auth/change-password', { currentPassword: f.values.currentPassword, newPassword: f.values.newPassword });
      setUser(r.user);
      navigate(homeFor(r.user.role), { replace: true });
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
        <Button variant="ghost" icon={LogOut} block onClick={async () => { await logout(); navigate('/login'); }}>Log out</Button>
      </form>
    </AuthShell>
  );
}
