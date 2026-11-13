import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { MailCheck, UserPlus } from 'lucide-react';
import AuthShell from './AuthShell.jsx';
import { Alert, Button, Loading } from '../../components/common/ui.jsx';
import { Field, Input, Select } from '../../components/forms/fields.jsx';
import PasswordInput from '../../components/forms/PasswordInput.jsx';
import RolePicker, { ROLE_OPTIONS } from '../../components/forms/RolePicker.jsx';
import ResendVerification from '../../components/forms/ResendVerification.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useForm } from '../../hooks/useForm.js';
import { errMsg, get } from '../../services/api.js';
import { homeFor } from '../../utils/format.js';

const INTRO = {
  student: 'Choose your institution. We will email you a link to verify your address, then you can log in.',
  supervisor: 'Choose your institution. Verify your email first, then your institution\'s coordinator approves your account.',
};
const TYPES = [['university', 'University'], ['college', 'College'], ['school', 'School'], ['institute', 'Institute'], ['training_center', 'Training centre'], ['other', 'Other']];
const OPTIONS = ROLE_OPTIONS.map((o) => (o.key === 'coordinator' ? { ...o, hint: 'Register your institution' } : o));

export default function Register() {
  const { user, register } = useAuth();
  const navigate = useNavigate();
  const [opts, setOpts] = useState(null);
  const [role, setRole] = useState('student');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const f = useForm({ name: '', email: '', studentId: '', departmentId: '', designation: '', setupCode: '', institutionId: '', institutionName: '', institutionType: 'university', departmentName: '', password: '', confirm: '' });

  useEffect(() => { get('/auth/registration-options').then(setOpts).catch((e) => setError(errMsg(e))); }, []);
  if (user && !done) return <Navigate to={homeFor(user.role)} replace />;

  const v = f.values;
  const platform = opts?.platform;
  const institution = opts?.institutions.find((i) => i._id === v.institutionId);
  const selfOff = role !== 'coordinator' && institution && !institution.allowSelfRegistration;
  const coordIntro = platform?.needsSetup
    ? 'First-time setup: you register the first institution and become the platform owner, who approves every institution that joins later.'
    : 'Register your institution as its coordinator. After you verify your email, the platform administrator reviews and approves it. Then you can log in and set up departments, terms and users.';

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (v.password !== v.confirm) { f.setErrors({ confirm: 'Passwords do not match' }); return; }
    setBusy(true);
    try {
      const r = await register({ role, name: v.name, email: v.email, password: v.password, studentId: role === 'student' ? v.studentId : undefined,
        institutionId: role === 'coordinator' ? undefined : v.institutionId, departmentId: role === 'coordinator' ? undefined : v.departmentId,
        institutionName: role === 'coordinator' ? v.institutionName : undefined, institutionType: role === 'coordinator' ? v.institutionType : undefined, departmentName: role === 'coordinator' ? v.departmentName || undefined : undefined,
        designation: role === 'supervisor' ? v.designation : undefined, setupCode: role === 'coordinator' && platform?.needsSetupCode ? v.setupCode : undefined });
      if (r.verificationRequired || r.pending) setDone({ message: r.message, email: r.email || v.email, emailSent: r.emailSent });
      else navigate(homeFor(r.user.role), { replace: true });
    } catch (err) {
      f.applyError(err);
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <AuthShell>
        <div className="center stack">
          <MailCheck size={44} style={{ color: 'var(--primary)', margin: '0 auto' }} />
          <h1>Check your email</h1>
          <p className="muted">{done.message}</p>
          {(<>
            <Alert tone="info">We sent a verification link to <strong>{done.email}</strong>. You must open it before you can log in. The link works for 24 hours.</Alert>
            {done.emailSent === false && <Alert tone="warning">Email delivery is not set up on this server yet, so nothing was sent. Ask your coordinator (or the platform administrator) to confirm your email, or see the setup guide.</Alert>}
            <ResendVerification email={done.email} />
          </>)}
          <Button to="/login">Back to login</Button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <h1>Create your account</h1>
      <p className="muted mb">Choose your role first.</p>
      <RolePicker value={role} options={OPTIONS} onChange={(r) => { setRole(r); setError(''); }} />
      <p className="muted small mb">{role === 'coordinator' ? coordIntro : INTRO[role]}</p>
      {!opts && !error ? <Loading /> : null}
      {role !== 'coordinator' && opts && opts.institutions.length === 0 && <Alert tone="warning" className="mb">No institution has joined yet. A coordinator must register the institution first - choose <strong>Coordinator</strong> above.</Alert>}
      {selfOff && <Alert tone="warning" className="mb">Self-registration is turned off at {institution.name}. Please ask its coordinator to create your account.</Alert>}
      {error && <Alert tone="danger" className="mb">{error}</Alert>}
      {opts && !selfOff && !(role !== 'coordinator' && opts.institutions.length === 0) && (
        <form className="stack" onSubmit={submit} noValidate>
          <Field label="Full name" required error={f.errors.name}><Input {...f.bind('name')} autoComplete="name" required /></Field>
          <Field label="Email" required error={f.errors.email}><Input type="email" {...f.bind('email')} autoComplete="email" required /></Field>
          {role === 'student' && <Field label="Student ID" required error={f.errors.studentId}><Input {...f.bind('studentId')} required /></Field>}
          {role !== 'coordinator' && (<>
            <Field label="Institution" required error={f.errors.institutionId} help="Your university, college or school. Not listed? Ask your coordinator to register it first.">
              <Select value={v.institutionId} onChange={(e) => { f.set('institutionId', e.target.value); f.set('departmentId', ''); }} required>
                <option value="">Select institution</option>
                {opts.institutions.map((i) => <option key={i._id} value={i._id}>{i.name}</option>)}
              </Select>
            </Field>
            <Field label="Department" required error={f.errors.departmentId}>
              <Select {...f.bind('departmentId')} required disabled={!institution}>
                <option value="">{institution ? 'Select department' : 'Choose an institution first'}</option>
                {(institution?.departments || []).map((d) => <option key={d._id} value={d._id}>{d.name}</option>)}
              </Select>
            </Field>
            {institution && institution.departments.length === 0 && <Alert tone="warning">{institution.name} has not added any department yet. Please ask its coordinator.</Alert>}
          </>)}
          {role === 'coordinator' && (<>
            <Field label="Institution name" required error={f.errors.institutionName} help="For example: Himalaya Engineering College"><Input {...f.bind('institutionName')} maxLength={160} required /></Field>
            <Field label="Type of institution" error={f.errors.institutionType}>
              <Select {...f.bind('institutionType')}>{TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
            </Field>
            <Field label="Your department (optional)" error={f.errors.departmentName} help="Students pick a department when they sign up. You can add more departments later."><Input {...f.bind('departmentName')} maxLength={120} /></Field>
          </>)}
          {role === 'supervisor' && <Field label="Designation" help="For example Lecturer or Associate Professor" error={f.errors.designation}><Input {...f.bind('designation')} maxLength={100} /></Field>}
          {role === 'coordinator' && platform?.needsSetupCode && <Field label="Setup code" required error={f.errors.setupCode} help={platform.setupCodeConfigured ? 'The value of COORDINATOR_SETUP_CODE in server/.env' : 'Not set yet: add COORDINATOR_SETUP_CODE=your-secret to server/.env and restart the server.'}><PasswordInput {...f.bind('setupCode')} autoComplete="off" /></Field>}
          <Field label="Password" required error={f.errors.password} help="At least 8 characters with a letter and a number."><PasswordInput showStrength {...f.bind('password')} autoComplete="new-password" required /></Field>
          <Field label="Confirm password" required error={f.errors.confirm}><PasswordInput {...f.bind('confirm')} autoComplete="new-password" required /></Field>
          <Button type="submit" icon={UserPlus} loading={busy} block>{role === 'supervisor' ? 'Send request for approval' : role === 'coordinator' ? (platform?.needsSetup ? 'Set up the platform' : 'Register my institution') : 'Create account'}</Button>
        </form>
      )}
      <p className="muted small mt center">Already have an account? <Link to="/login">Log in</Link></p>
    </AuthShell>
  );
}
