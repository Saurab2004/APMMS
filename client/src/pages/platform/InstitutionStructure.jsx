import { useState } from 'react';
import { Building, Layers, Plus, Trash2, UserPlus, Mail } from 'lucide-react';
import { Alert, Badge, Button, Card, CardBody, CardHead, ErrorState, Loading } from '../../components/common/ui.jsx';
import { Modal, ConfirmDialog } from '../../components/common/Modal.jsx';
import { Field, Input, Select } from '../../components/forms/fields.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { useForm } from '../../hooks/useForm.js';
import { useToast } from '../../context/ToastContext.jsx';
import { errMsg, get, post, del } from '../../services/api.js';
import { CoordinatorActions, CoordinatorBadges, InviteLinkDialog } from './platformShared.jsx';

function FacultyDialog({ instId, mode, onClose, onDone }) {
  const toast = useToast();
  const f = useForm({ name: '' });
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true);
    try { await post(mode === 'coordinator' ? '/faculties' : `/platform/institutions/${instId}/faculties`, { name: f.values.name.trim() }); toast.success('Faculty added'); onDone(); }
    catch (err) { f.applyError(err); toast.error(errMsg(err)); } finally { setBusy(false); }
  };
  return (
    <Modal title="Add a faculty" onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="add-fac" loading={busy}>Add faculty</Button></>}>
      <form id="add-fac" className="stack" onSubmit={submit}>
        <Field label="Faculty name" required error={f.errors.name} help="For example: Faculty of Engineering"><Input {...f.bind('name')} required maxLength={120} /></Field>
      </form>
    </Modal>
  );
}

function DepartmentDialog({ instId, mode, faculty, onClose, onDone }) {
  const toast = useToast();
  const f = useForm({ name: '', code: '' });
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true);
    try { await post(mode === 'coordinator' ? '/departments' : `/platform/institutions/${instId}/departments`, { name: f.values.name.trim(), code: f.values.code.trim() || undefined, facultyId: faculty._id }); toast.success('Department added'); onDone(); }
    catch (err) { f.applyError(err); toast.error(errMsg(err)); } finally { setBusy(false); }
  };
  return (
    <Modal title={`Add a department to ${faculty.name}`} onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="add-dep" loading={busy}>Add department</Button></>}>
      <form id="add-dep" className="stack" onSubmit={submit}>
        <Field label="Department name" required error={f.errors.name}><Input {...f.bind('name')} required maxLength={120} /></Field>
        <Field label="Short code (optional)" error={f.errors.code} help="For example CSE"><Input {...f.bind('code')} maxLength={12} /></Field>
      </form>
    </Modal>
  );
}

function InviteDialog({ instId, mode, department, onClose, onDone }) {
  const toast = useToast();
  const f = useForm({ name: '', email: '' });
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(null);
  const level = department ? 'department' : 'institution';
  const submit = async (e) => {
    e.preventDefault(); setBusy(true);
    try {
      const body = { name: f.values.name.trim(), email: f.values.email.trim() };
      const r = mode === 'coordinator' ? await post(`/departments/${department._id}/coordinator`, body) : await post(`/platform/institutions/${instId}/coordinators`, { ...body, level, departmentId: department?._id });
      setSent(r);
    } catch (err) { f.applyError(err); toast.error(errMsg(err)); } finally { setBusy(false); }
  };
  if (sent) return <InviteLinkDialog title="Coordinator invited" email={sent.coordinator.email} emailed={sent.emailed} link={sent.link} onClose={onDone} />;
  return (
    <Modal title={department ? `Invite the coordinator of ${department.name}` : 'Invite an institution-level coordinator'} onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="invite-c" loading={busy} icon={UserPlus}>Send invitation</Button></>}>
      <form id="invite-c" className="stack" onSubmit={submit}>
        <p className="muted" style={{ margin: 0 }}>{department ? 'This person manages only this department: its students, supervisors, groups, projects and batches.' : 'An institution-level coordinator manages all departments, terms and settings.'} They receive an email with a link to set their own password.</p>
        <Field label="Name" required error={f.errors.name}><Input {...f.bind('name')} required /></Field>
        <Field label="Email" required error={f.errors.email}><Input type="email" {...f.bind('email')} required /></Field>
      </form>
    </Modal>
  );
}

/** Faculties -> departments -> one coordinator each. Used by the platform admin (mode admin) and the institution coordinator (mode coordinator). */
export default function InstitutionStructure({ instId, onChanged, mode = 'admin' }) {
  const coord = mode === 'coordinator';
  const st = useAsync(() => get(coord ? '/structure' : `/platform/institutions/${instId}/structure`), [instId, mode]);
  const [dlg, setDlg] = useState(null);
  const [busyDel, setBusyDel] = useState(false);
  const toast = useToast();
  const doDelete = async () => {
    setBusyDel(true);
    try { await del(coord ? `/${dlg.kind}s/${dlg.item._id}` : `/platform/${dlg.kind === 'faculty' ? 'faculties' : 'departments'}/${dlg.item._id}`); toast.success(`${dlg.kind === 'faculty' ? 'Faculty' : 'Department'} deleted`); setBusyDel(false); reload(); }
    catch (err) { toast.error(errMsg(err)); setBusyDel(false); setDlg(null); }
  };
  const resend = async (c) => { try { const r = await post(`/users/${c._id}/resend-invitation`); setDlg({ type: 'link', c, r }); } catch (err) { toast.error(errMsg(err)); } };
  const reload = () => { setDlg(null); st.reload(); onChanged?.(); };
  if (st.loading && !st.data) return <Loading />;
  if (st.error) return <ErrorState message={st.error} onRetry={st.reload} />;
  const { faculties, departments, institutionCoordinators = [], inactiveDepartmentCoordinators = [], emailConfigured } = st.data;
  return (
    <>
      {emailConfigured === false && <Alert tone="warning" className="mb">Email is not set up on this server yet. Invitations are still created, but you will be shown each link to send by hand. See the setup guide (Brevo) to turn emails on.</Alert>}
      <Card className="mb">
        <CardHead title="Faculties, departments and coordinators"><Button size="sm" icon={Plus} onClick={() => setDlg({ type: 'faculty' })}>Add faculty</Button></CardHead>
        <CardBody className="stack">
          {faculties.length === 0 && <p className="muted small" style={{ margin: 0 }}>No faculty yet. Add a faculty first, then its departments.</p>}
          {faculties.map((fac) => {
            const deps = departments.filter((d) => String(d.faculty) === String(fac._id));
            return (
              <div key={fac._id} className="stack" style={{ border: '1px solid var(--border, #e2e8f0)', borderRadius: 10, padding: 12 }}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <strong><Building size={15} aria-hidden="true" style={{ verticalAlign: '-2px' }} /> {fac.name}</strong>
                  <span className="row" style={{ gap: 6 }}>
                    <Button size="sm" variant="secondary" icon={Plus} onClick={() => setDlg({ type: 'department', faculty: fac })}>Add department</Button>
                    <Button size="sm" variant="danger" icon={Trash2} onClick={() => setDlg({ type: 'delete', kind: 'faculty', item: fac })}>Delete faculty</Button>
                  </span>
                </div>
                {deps.length === 0 && <p className="muted small" style={{ margin: 0 }}>No department in this faculty yet.</p>}
                {deps.map((d) => (
                  <div key={d._id} className="row wrap" style={{ justifyContent: 'space-between', gap: 8, paddingLeft: 8 }}>
                    <span><Layers size={14} aria-hidden="true" style={{ verticalAlign: '-2px' }} /> {d.name}{d.code ? <span className="muted small"> ({d.code})</span> : null}</span>
                    {d.coordinator
                      ? <span className="stack" style={{ gap: 2 }}><span className="small"><strong>{d.coordinator.name}</strong> <span className="muted">{d.coordinator.email}</span></span><CoordinatorBadges c={d.coordinator} />{coord ? (d.coordinator.invitePending ? <Button size="sm" variant="secondary" icon={Mail} onClick={() => resend(d.coordinator)}>Resend invitation</Button> : null) : <CoordinatorActions c={d.coordinator} onDone={reload} />}</span>
                      : <Button size="sm" icon={UserPlus} onClick={() => setDlg({ type: 'invite', department: d })}>Invite coordinator</Button>}
                    <Button size="sm" variant="danger" icon={Trash2} onClick={() => setDlg({ type: 'delete', kind: 'department', item: d })}>Delete</Button>
                  </div>
                ))}
              </div>
            );
          })}
        </CardBody>
      </Card>
      {!coord && <Card className="mb">
        <CardHead title="Institution-level coordinators"><Button size="sm" variant="secondary" icon={UserPlus} onClick={() => setDlg({ type: 'invite' })}>Invite</Button></CardHead>
        <CardBody>
          {institutionCoordinators.length === 0 ? <p className="muted small" style={{ margin: 0 }}>None. Optional: they manage all departments, terms and settings.</p> : (
            <ul className="list">{institutionCoordinators.map((c) => (
              <li key={c._id} className="stack" style={{ gap: 4 }}><div><strong>{c.name}</strong> <CoordinatorBadges c={c} /></div><div className="muted small">{c.email}</div><CoordinatorActions c={c} onDone={reload} /></li>
            ))}</ul>
          )}
          {inactiveDepartmentCoordinators.length > 0 && <p className="muted small mt" style={{ marginBottom: 0 }}>Deactivated department coordinators: {inactiveDepartmentCoordinators.map((c) => c.email).join(', ')} <Badge tone="danger">inactive</Badge></p>}
        </CardBody>
      </Card>}
      {dlg?.type === 'faculty' && <FacultyDialog instId={instId} mode={mode} onClose={() => setDlg(null)} onDone={reload} />}
      {dlg?.type === 'department' && <DepartmentDialog instId={instId} mode={mode} faculty={dlg.faculty} onClose={() => setDlg(null)} onDone={reload} />}
      {dlg?.type === 'invite' && <InviteDialog instId={instId} mode={mode} department={dlg.department} onClose={() => setDlg(null)} onDone={reload} />}
      {dlg?.type === 'delete' && <ConfirmDialog title={`Delete ${dlg.kind}?`} danger confirmLabel="Delete" loading={busyDel} onConfirm={doDelete} onClose={() => setDlg(null)}
        message={dlg.kind === 'faculty' ? `Delete the faculty "${dlg.item.name}"? This only works when it has no departments.` : `Delete the department "${dlg.item.name}" and its coordinator account? This only works when it has no students, supervisors, batches or groups; otherwise deactivate it instead.`} />}
      {dlg?.type === 'link' && <InviteLinkDialog title="Invitation" email={dlg.c.email} emailed={dlg.r.emailed} link={dlg.r.link} onClose={() => setDlg(null)} />}
    </>
  );
}
