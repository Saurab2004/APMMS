import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { LogIn } from 'lucide-react';
import AuthShell from './AuthShell.jsx';
import { Alert, Button } from '../../components/common/ui.jsx';
import { Field, Input } from '../../components/forms/fields.jsx';
import PasswordInput from '../../components/forms/PasswordInput.jsx';
import ResendVerification from '../../components/forms/ResendVerification.jsx';
import RolePicker, { EVALUATOR_OPTION, ROLE_OPTIONS } from '../../components/forms/RolePicker.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { errMsg } from '../../services/api.js';
import { homeFor } from '../../utils/format.js';

const remembered = () => { try { return localStorage.getItem('apmms.role') || 'student'; } catch { return 'student'; } };

/** One login page for everybody: pick your role, then sign in. */
export default function Login() {
  const { user, login, sessionExpired } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [role, setRole] = useState(remembered);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [unverified, setUnverified] = useState(false);
  const [busy, setBusy] = useState(false);

  if (user && !user.mustChangePassword) return <Navigate to={homeFor(user.role)} replace />;

  const pick = (r) => { setRole(r); setError(''); try { localStorage.setItem('apmms.role', r); } catch { /* ignore */ } };
  const label = [...ROLE_OPTIONS, EVALUATOR_OPTION].find((r) => r.key === role)?.label;

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setUnverified(false);
    setBusy(true);
    try {
      const u = await login(email.trim(), password, role);
      if (u.mustChangePassword) return navigate('/change-password', { replace: true });
      const from = location.state?.from;
      navigate(from && from.startsWith(homeFor(u.role)) ? from : homeFor(u.role), { replace: true });
    } catch (err) {
      setError(errMsg(err));
      setUnverified(err.code === 'EMAIL_NOT_VERIFIED');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell>
      <h1>Welcome back</h1>
      <p className="muted mb">Choose your role, then log in.</p>
      {sessionExpired && <Alert tone="warning" className="mb">Your session has expired. Please log in again.</Alert>}
      <RolePicker value={role} onChange={pick} options={ROLE_OPTIONS} />
      {error && <Alert tone={/waiting/.test(error) || unverified ? 'warning' : 'danger'} className="mb">{error}</Alert>}
      {unverified && <div className="mb"><ResendVerification email={email.trim()} /></div>}
      <form className="stack" onSubmit={submit} noValidate>
        <Field label="Email" required><Input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus /></Field>
        <Field label="Password" required><PasswordInput autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
        <div className="row between"><span /><Link to="/forgot-password" className="small">Forgot password?</Link></div>
        <Button type="submit" icon={LogIn} loading={busy} block disabled={!email || !password}>Log in as {label}</Button>
      </form>
      <p className="muted small mt center">New here? <Link to="/register">Create an account</Link></p>
      <p className="muted small center">
        {role === 'evaluator' ? <>External evaluator accounts are created by the coordinator. <button type="button" className="link-btn" onClick={() => pick('student')}>Back to student login</button></>
          : <>Invited as an external evaluator? <button type="button" className="link-btn" onClick={() => pick('evaluator')}>Log in as evaluator</button></>}
      </p>
    </AuthShell>
  );
}
