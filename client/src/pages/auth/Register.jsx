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
const OPTIONS = ROLE_OPTIONS.filter((o) => o.key !== 'coordinator');

export default function Register() {
  const { user, register } = useAuth();
  const navigate = useNavigate();
  const [opts, setOpts] = useState(null);
  const [role, setRole] = useState('student');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const f = useForm({ name: '', email: '', studentId: '', facultyId: '', departmentId: '', batchId: '', designation: '', institutionId: '', password: '', confirm: '' });

  useEffect(() => { get('/auth/registration-options').then(setOpts).catch((e) => setError(errMsg(e))); }, []);
  if (user && !done) return <Navigate to={homeFor(user.role)} replace />;

  const v = f.values;
  const institution = opts?.institutions.find((i) => i._id === v.institutionId);
  const faculty = institution?.faculties?.find((x) => x._id === v.facultyId);
  const deptsOfFaculty = (institution?.departments || []).filter((d) => String(d.faculty) === String(v.facultyId));
  const department = institution?.departments.find((d) => d._id === v.departmentId);
  const selfOff = institution && !institution.allowSelfRegistration;

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (v.password !== v.confirm) { f.setErrors({ confirm: 'Passwords do not match' }); return; }
    setBusy(true);
    try {
      const r = await register({ role, name: v.name, email: v.email, password: v.password, studentId: role === 'student' ? v.studentId : undefined,
        institutionId: v.institutionId, facultyId: v.facultyId, departmentId: v.departmentId, batchId: role === 'student' ? v.batchId || undefined : undefined,
        designation: role === 'supervisor' ? v.designation : undefined });
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
            {done.emailSent === false && <Alert tone="warning">Email delivery is not set up on this server yet, so nothing was sent. Ask your coordinator (or the APMMS administrator) to confirm your email, or see the setup guide.</Alert>}
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
      <p className="muted small mb">{INTRO[role]}</p>
      <p className="muted small mb">Coordinators do not sign up here: the APMMS administrator invites them by email.</p>
      {!opts && !error ? <Loading /> : null}
      {opts && opts.institutions.length === 0 && <Alert tone="warning" className="mb">No institution has been added yet. The APMMS administrator adds institutions - please check back later.</Alert>}
      {selfOff && <Alert tone="warning" className="mb">Self-registration is turned off at {institution.name}. Please ask its coordinator to create your account.</Alert>}
      {error && <Alert tone="danger" className="mb">{error}</Alert>}
      {opts && !selfOff && opts.institutions.length > 0 && (
        <form className="stack" onSubmit={submit} noValidate>
          <Field label="Full name" required error={f.errors.name}><Input {...f.bind('name')} autoComplete="name" required /></Field>
          <Field label="Email" required error={f.errors.email}><Input type="email" {...f.bind('email')} autoComplete="email" required /></Field>
          {role === 'student' && <Field label="Student ID" required error={f.errors.studentId}><Input {...f.bind('studentId')} required /></Field>}
          <Field label="Institution" required error={f.errors.institutionId} help="Only institutions added by the APMMS administrator are listed.">
            <Select value={v.institutionId} onChange={(e) => { f.set('institutionId', e.target.value); f.set('facultyId', ''); f.set('departmentId', ''); f.set('batchId', ''); }} required>
              <option value="">Select institution</option>
              {opts.institutions.map((i) => <option key={i._id} value={i._id}>{i.name}</option>)}
            </Select>
          </Field>
          <Field label="Faculty" required error={f.errors.facultyId}>
            <Select value={v.facultyId} onChange={(e) => { f.set('facultyId', e.target.value); f.set('departmentId', ''); f.set('batchId', ''); }} required disabled={!institution}>
              <option value="">{institution ? 'Select faculty' : 'Choose an institution first'}</option>
              {(institution?.faculties || []).map((x) => <option key={x._id} value={x._id}>{x.name}</option>)}
            </Select>
          </Field>
          <Field label="Department" required error={f.errors.departmentId}>
            <Select value={v.departmentId} onChange={(e) => { f.set('departmentId', e.target.value); f.set('batchId', ''); }} required disabled={!faculty}>
              <option value="">{faculty ? 'Select department' : 'Choose a faculty first'}</option>
              {deptsOfFaculty.map((d) => <option key={d._id} value={d._id}>{d.name}</option>)}
            </Select>
          </Field>
          {role === 'student' && department && department.batches?.length > 0 && (
            <Field label="Batch" required error={f.errors.batchId} help="Your intake, for example the year you joined. Your groups and deadlines follow your batch.">
              <Select {...f.bind('batchId')} required>
                <option value="">Select your batch</option>
                {department.batches.map((b) => <option key={b._id} value={b._id}>{b.name}</option>)}
              </Select>
            </Field>
          )}
          {role === 'student' && department && !department.batches?.length && <Alert tone="info">This department has not opened a batch yet. You can still sign up; the coordinator will place you in your batch later.</Alert>}
          {faculty && deptsOfFaculty.length === 0 && <Alert tone="warning">This faculty has no department yet. Please contact your institution.</Alert>}
          {role === 'supervisor' && <Field label="Designation" help="For example Lecturer or Associate Professor" error={f.errors.designation}><Input {...f.bind('designation')} maxLength={100} /></Field>}
          <Field label="Password" required error={f.errors.password} help="At least 8 characters with a letter and a number."><PasswordInput showStrength {...f.bind('password')} autoComplete="new-password" required /></Field>
          <Field label="Confirm password" required error={f.errors.confirm}><PasswordInput {...f.bind('confirm')} autoComplete="new-password" required /></Field>
          <Button type="submit" icon={UserPlus} loading={busy} block>{role === 'supervisor' ? 'Send request for approval' : 'Create account'}</Button>
        </form>
      )}
      <p className="muted small mt center">Already have an account? <Link to="/login">Log in</Link></p>
    </AuthShell>
  );
}
