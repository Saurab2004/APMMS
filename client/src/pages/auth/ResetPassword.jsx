import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { KeyRound } from 'lucide-react';
import AuthShell from './AuthShell.jsx';
import { Alert, Button } from '../../components/common/ui.jsx';
import { Field, Input } from '../../components/forms/fields.jsx';
import { errMsg, post } from '../../services/api.js';
import { useToast } from '../../context/ToastContext.jsx';

export default function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const invite = params.get('invite') === '1';
  const navigate = useNavigate();
  const toast = useToast();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const mismatch = confirm && password !== confirm;
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try { await post('/auth/reset-password', { token, password }); toast.success(invite ? 'Your account is ready. Please log in.' : 'Password updated. Please log in.'); navigate('/login'); } catch (err) { setError(errMsg(err)); } finally { setBusy(false); }
  };
  return (
    <AuthShell>
      <h1>{invite ? 'Welcome - set your password' : 'Choose a new password'}</h1>
      {invite && <p className="muted">You were invited to APMMS. Choosing a password also confirms your email address.</p>}
      {!token && <Alert tone="danger" className="mt">This link is missing its token. <Link to="/forgot-password">Request a new one</Link>.</Alert>}
      {error && <Alert tone="danger" className="mt">{error}</Alert>}
      <form className="stack mt" onSubmit={submit}>
        <Field label="New password" required help="At least 8 characters with a letter and a number."><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required /></Field>
        <Field label="Confirm password" required error={mismatch ? 'Passwords do not match' : undefined}><Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required /></Field>
        <Button type="submit" icon={KeyRound} loading={busy} block disabled={!token || !password || mismatch}>{invite ? 'Activate my account' : 'Update password'}</Button>
      </form>
    </AuthShell>
  );
}
