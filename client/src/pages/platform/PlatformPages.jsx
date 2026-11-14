import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Building2, Download, Pencil, Plus, Search, TriangleAlert } from 'lucide-react';
import { Alert, Badge, Button, Card, CardBody, CardHead, EmptyState, ErrorState, KV, Loading, PageHeader, StatCard } from '../../components/common/ui.jsx';
import { Modal } from '../../components/common/Modal.jsx';
import DataTable from '../../components/tables/DataTable.jsx';
import { Field, Input, Select } from '../../components/forms/fields.jsx';
import { useAsync, useDebounced } from '../../hooks/useAsync.js';
import { useForm } from '../../hooks/useForm.js';
import { useToast } from '../../context/ToastContext.jsx';
import { downloadFile, errMsg, get, patch, post } from '../../services/api.js';
import { fmtDate, fmtDateTime, timeAgo } from '../../utils/format.js';
import { ACTIONS_FOR, CoordinatorActions, CoordinatorBadges, DECISIONS, DecisionDialog, STATUS_LABEL, STATUS_TONE, TYPE, TempPasswordDialog } from './platformShared.jsx';

const StatusBadgeP = ({ status }) => <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status] || status}</Badge>;
const peopleText = (c) => `${c.students} students, ${c.supervisors} supervisors`;

export function PlatformOverview() {
  const state = useAsync(() => get('/platform/overview'), []);
  if (state.loading && !state.data) return <Loading />;
  if (state.error) return <ErrorState message={state.error} onRetry={state.reload} />;
  const d = state.data;
  const att = d.attention;
  return (
    <>
      <PageHeader title="Platform overview" subtitle="All institutions on this website. You see counts and account details only, never students' project work." actions={<Button to="/platform/institutions" variant="secondary" icon={Building2}>Manage institutions</Button>} />
      {(att.coordinatorsNotVerified > 0 || att.deletedWaitingForErase > 0 || att.pendingInstitutions > 0) && (
        <div className="stack mb">
          {att.pendingInstitutions > 0 && <Alert tone="warning"><strong>{att.pendingInstitutions}</strong> institution(s) are waiting for their coordinator to verify the email. <Link to="/platform/institutions?status=pending">View</Link></Alert>}
          {att.coordinatorsNotVerified > 0 && <Alert tone="warning"><strong>{att.coordinatorsNotVerified}</strong> coordinator(s) have not verified their email for over a day. You can resend the email or mark it verified. <Link to="/platform/coordinators?state=unverified">View</Link></Alert>}
          {att.deletedWaitingForErase > 0 && <Alert tone="info"><strong>{att.deletedWaitingForErase}</strong> institution(s) were deleted by their coordinator and will be erased after the grace period. You can restore them until then. <Link to="/platform/institutions?status=deleted">View</Link></Alert>}
        </div>
      )}
      <div className="grid mb" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
        <StatCard icon={Building2} label="Institutions" value={d.institutions.total} to="/platform/institutions" />
        <StatCard label="Active" value={d.institutions.approved} tone="success" to="/platform/institutions?status=approved" />
        <StatCard label="Suspended" value={d.institutions.suspended} tone={d.institutions.suspended ? 'danger' : undefined} to="/platform/institutions?status=suspended" />
        <StatCard label="Waiting for verification" value={d.institutions.pending} tone={d.institutions.pending ? 'warning' : undefined} to="/platform/institutions?status=pending" />
      </div>
      <h2 className="section-title">Across all institutions</h2>
      <div className="grid mb" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
        <StatCard label="Coordinators" value={d.totals.coordinators} to="/platform/coordinators" />
        <StatCard label="Supervisors" value={d.totals.supervisors} />
        <StatCard label="Students" value={d.totals.students} />
        <StatCard label="Groups" value={d.totals.groups} />
        <StatCard label="Projects" value={d.totals.projects} />
      </div>
      <Card>
        <CardHead title="Newest institutions"><Link className="small" to="/platform/institutions">All institutions</Link></CardHead>
        <CardBody>
          {!d.recent.length ? <p className="muted small" style={{ margin: 0 }}>No institutions yet.</p> : (
            <ul className="list">{d.recent.map((i) => (
              <li key={i._id} className="row between wrap">
                <span><Link to={`/platform/institutions/${i._id}`}><strong>{i.name}</strong></Link> <StatusBadgeP status={i.status} /><div className="muted small">{TYPE[i.type] || i.type} - registered {timeAgo(i.createdAt)} - {peopleText(i.counts)}</div></span>
              </li>))}
            </ul>
          )}
        </CardBody>
      </Card>
    </>
  );
}

function AddInstitutionDialog({ onClose, onCreated }) {
  const toast = useToast();
  const f = useForm({ institutionName: '', institutionType: 'university', coordinatorName: '', coordinatorEmail: '' });
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try { onCreated(await post('/platform/institutions', { ...f.values, institutionName: f.values.institutionName.trim(), coordinatorName: f.values.coordinatorName.trim(), coordinatorEmail: f.values.coordinatorEmail.trim() })); }
    catch (err) { f.applyError(err); toast.error(errMsg(err)); } finally { setBusy(false); }
  };
  return (
    <Modal title="Add an institution" onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="add-inst" loading={busy}>Create</Button></>}>
      <form id="add-inst" className="stack" onSubmit={submit}>
        <p className="muted" style={{ margin: 0 }}>Creates an active institution and its first coordinator. You get a one-time temporary password for the coordinator (it is also emailed when email is configured).</p>
        <Field label="Institution name" required error={f.errors.institutionName}><Input {...f.bind('institutionName')} required /></Field>
        <Field label="Type"><Select {...f.bind('institutionType')}>{Object.entries(TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
        <Field label="Coordinator name" required error={f.errors.coordinatorName}><Input {...f.bind('coordinatorName')} required /></Field>
        <Field label="Coordinator email" required error={f.errors.coordinatorEmail}><Input type="email" {...f.bind('coordinatorEmail')} required /></Field>
      </form>
    </Modal>
  );
}

export function PlatformInstitutions() {
  const navigate = useNavigate();
  const toast = useToast();
  const [sp] = useSearchParams();
  const [status, setStatus] = useState(sp.get('status') || '');
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const list = useAsync(() => get('/platform/institutions', { status: status || undefined, q: dq || undefined }), [status, dq]);
  const [adding, setAdding] = useState(false);
  const [created, setCreated] = useState(null);

  const columns = [
    { key: 'name', header: 'Institution', render: (i) => <><Link to={`/platform/institutions/${i._id}`}><strong>{i.name}</strong></Link><div className="muted small">{TYPE[i.type] || i.type}</div></> },
    { key: 'status', header: 'Status', render: (i) => <StatusBadgeP status={i.status} /> },
    { key: 'coord', header: 'Coordinator', render: (i) => i.coordinators.length ? i.coordinators.map((c) => <div key={c._id} className="small">{c.name}<div className="muted">{c.email}</div></div>) : <span className="muted small">none</span> },
    { key: 'people', header: 'People', render: (i) => <span className="small">{peopleText(i.counts)}<div className="muted">{i.counts.groups} groups, {i.counts.projects} projects</div></span> },
    { key: 'created', header: 'Registered', render: (i) => <span className="small">{fmtDate(i.createdAt)}</span> },
    { key: 'go', header: '', render: (i) => <Button size="sm" variant="secondary" to={`/platform/institutions/${i._id}`}>Open</Button> },
  ];
  return (
    <>
      <PageHeader title="Institutions" subtitle="Every university, college or school is its own separate workspace. New ones activate themselves when their coordinator verifies their email; you can suspend, restore or erase any of them."
        actions={<><Button variant="secondary" icon={Download} onClick={() => downloadFile(`/platform/institutions/export.csv${status ? `?status=${status}` : ''}`, 'institutions.csv').catch((e) => toast.error(errMsg(e)))}>Export CSV</Button><Button icon={Plus} onClick={() => setAdding(true)}>Add institution</Button></>} />
      <Card className="mb"><CardBody className="row wrap">
        <div style={{ position: 'relative', minWidth: 220, flex: '1 1 220px' }}>
          <Search size={16} aria-hidden="true" style={{ position: 'absolute', left: 10, top: 12, opacity: 0.5 }} />
          <Input aria-label="Search institutions" placeholder="Search by name..." value={q} onChange={(e) => setQ(e.target.value)} style={{ paddingLeft: 32 }} />
        </div>
        <Select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: 230 }}>
          <option value="">All statuses</option>{Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
      </CardBody></Card>
      <DataTable columns={columns} rows={list.data} loading={list.loading} error={list.error} onRetry={list.reload} minWidth={760}
        empty={<EmptyState icon={Building2} title="No institutions here">Institutions appear when a coordinator registers one, or when you add one.</EmptyState>} />
      {adding && <AddInstitutionDialog onClose={() => setAdding(false)} onCreated={(r) => { setAdding(false); setCreated(r); list.reload(); }} />}
      {created && <TempPasswordDialog title={`${created.institution.name} created`} email={created.coordinator.email} password={created.tempPassword} emailed={created.emailed} onClose={() => { const id = created.institution._id; setCreated(null); navigate(`/platform/institutions/${id}`); }} />}
    </>
  );
}

export function PlatformInstitutionDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const state = useAsync(() => get(`/platform/institutions/${id}`), [id]);
  const [dlg, setDlg] = useState(null);
  const [editing, setEditing] = useState(false);
  const f = useForm({ name: '', type: 'university' });
  const [busy, setBusy] = useState(false);

  if (state.loading && !state.data) return <Loading />;
  if (state.error) return <ErrorState message={state.error} onRetry={state.reload} />;
  const i = state.data;
  const startEdit = () => { f.setValues({ name: i.name, type: i.type }); setEditing(true); };
  const saveEdit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try { await patch(`/platform/institutions/${id}`, { name: f.values.name, type: f.values.type }); toast.success('Saved'); setEditing(false); state.reload(); }
    catch (err) { f.applyError(err); toast.error(errMsg(err)); } finally { setBusy(false); }
  };
  const actions = ACTIONS_FOR[i.status] || [];
  return (
    <>
      <PageHeader title={i.name} subtitle={`${TYPE[i.type] || i.type} - registered ${fmtDate(i.createdAt)}`}
        actions={<>
          <Button variant="secondary" icon={Pencil} onClick={startEdit}>Rename</Button>
          {actions.map((a) => <Button key={a} variant={DECISIONS[a].danger ? 'secondary' : 'primary'} onClick={() => setDlg(a)}>{DECISIONS[a].label}</Button>)}
        </>} />
      <div className="row mb"><StatusBadgeP status={i.status} />{i.statusNote && <span className="muted small">Note: {i.statusNote}</span>}</div>
      {i.status === 'deleted' && i.purgeAt && <Alert tone="warning" className="mb">Deleted by its coordinator. Everything is erased for good on <strong>{fmtDate(i.purgeAt)}</strong> unless you restore it.</Alert>}
      {i.status === 'pending' && <Alert tone="info" className="mb">Waiting for the coordinator to verify their email; it then activates by itself. If they cannot receive the email, use <em>Mark verified</em> below, or <em>Activate</em> above.</Alert>}
      <div className="grid mb" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
        <StatCard label="Students" value={i.counts.students} /><StatCard label="Supervisors" value={i.counts.supervisors} hint={i.counts.pendingSupervisors ? `${i.counts.pendingSupervisors} waiting for approval` : undefined} />
        <StatCard label="Groups" value={i.counts.groups} /><StatCard label="Projects" value={i.counts.projects} /><StatCard label="Departments" value={i.counts.departments} />
      </div>
      <div className="grid cols-2" style={{ alignItems: 'start' }}>
        <Card><CardHead title="Details" /><CardBody><KV items={[['Name', i.name], ['Type', TYPE[i.type] || i.type], ['Status', STATUS_LABEL[i.status] || i.status], ['Registered', fmtDateTime(i.createdAt)], ['Last login by anyone', i.lastActivityAt ? `${fmtDateTime(i.lastActivityAt)} (${timeAgo(i.lastActivityAt)})` : 'Never'], i.decidedAt && ['Last status change', fmtDateTime(i.decidedAt)]]} /></CardBody></Card>
        <Card><CardHead title="Coordinators" /><CardBody>
          {!i.coordinators.length ? <p className="muted small" style={{ margin: 0 }}>No coordinator accounts.</p> : (
            <ul className="list">{i.coordinators.map((c) => (
              <li key={c._id} className="stack" style={{ gap: 4 }}>
                <div><strong>{c.name}</strong> <CoordinatorBadges c={c} /></div>
                <div className="muted small">{c.email} - last login {c.lastLoginAt ? timeAgo(c.lastLoginAt) : 'never'}</div>
                <CoordinatorActions c={c} onDone={state.reload} />
              </li>))}
            </ul>
          )}
        </CardBody></Card>
      </div>
      {dlg && <DecisionDialog inst={i} decision={dlg} onClose={() => setDlg(null)} onDone={(d) => { setDlg(null); if (d === 'purge') navigate('/platform/institutions'); else state.reload(); }} />}
      {editing && (
        <Modal title="Rename institution" onClose={() => setEditing(false)} footer={<><Button variant="secondary" onClick={() => setEditing(false)}>Cancel</Button><Button type="submit" form="edit-inst" loading={busy}>Save</Button></>}>
          <form id="edit-inst" className="stack" onSubmit={saveEdit}>
            <Field label="Name" required error={f.errors.name}><Input {...f.bind('name')} required /></Field>
            <Field label="Type"><Select {...f.bind('type')}>{Object.entries(TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
          </form>
        </Modal>
      )}
      <p className="muted small mt"><TriangleAlert size={13} aria-hidden="true" style={{ verticalAlign: '-2px' }} /> As a platform admin you see counts and account details. You cannot open this institution's students, projects or reports.</p>
    </>
  );
}
