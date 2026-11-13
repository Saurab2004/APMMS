import { useEffect, useState } from 'react';
import { MailCheck } from 'lucide-react';
import { Alert, Button } from '../common/ui.jsx';
import { Field, Input } from './fields.jsx';
import { errMsg, post } from '../../services/api.js';

const COOLDOWN = 60; // seconds; the server enforces the same limit

/** "Resend verification email": asks for the email only when it is not already known. */
export default function ResendVerification({ email: known = '', label = 'Resend verification email' }) {
  const [email, setEmail] = useState(known);
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(0);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  useEffect(() => { setEmail(known); }, [known]);
  useEffect(() => {
    if (wait <= 0) return undefined;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  const send = async () => {
    setBusy(true); setError(''); setMsg('');
    try {
      const r = await post('/auth/resend-verification', { email: email.trim() });
      setMsg(r.message);
      setWait(COOLDOWN);
    } catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  };

  return (
    <div className="stack" style={{ gap: 8 }}>
      {!known && <Field label="Your email"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" /></Field>}
      <Button variant="secondary" icon={MailCheck} loading={busy} disabled={!email.trim() || wait > 0} onClick={send}>{wait > 0 ? `${label} (${wait}s)` : label}</Button>
      {msg && <Alert tone="success">{msg} Also check your spam folder.</Alert>}
      {error && <Alert tone="danger">{error}</Alert>}
    </div>
  );
}
