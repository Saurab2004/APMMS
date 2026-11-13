import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Mail } from 'lucide-react';
import AuthShell from './AuthShell.jsx';
import { Alert, Button } from '../../components/common/ui.jsx';
import { Field, Input } from '../../components/forms/fields.jsx';
import { errMsg, post } from '../../services/api.js';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [done, setDone] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try { setDone((await post('/auth/forgot-password', { email })).message); } catch (err) { setError(errMsg(err)); } finally { setBusy(false); }
  };
  return (
    <AuthShell>
      <h1>Forgot your password?</h1>
      <p className="muted mb">Enter your email and we will generate a reset link.</p>
      {error && <Alert tone="danger" className="mb">{error}</Alert>}
      {done ? (
        <Alert tone="success">
          {done}
          <div className="small mt">Email delivery is not configured in this installation: the link is printed in the <strong>server console</strong> (ask your administrator, or see the setup guide).</div>
        </Alert>
      ) : (
        <form className="stack" onSubmit={submit}>
          <Field label="Email" required><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus /></Field>
          <Button type="submit" icon={Mail} loading={busy} block>Send reset link</Button>
        </form>
      )}
      <p className="small mt center"><Link to="/login">Back to log in</Link></p>
    </AuthShell>
  );
}
