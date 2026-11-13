import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert, Badge, Button, Card, CardBody, PageHeader, ProgressBar, StatusBadge } from '../../components/common/ui.jsx';
import DataTable from '../../components/tables/DataTable.jsx';
import { ConfirmDialog, Modal } from '../../components/common/Modal.jsx';
import { Field, SearchInput, Select } from '../../components/forms/fields.jsx';
import { usePaged } from '../../hooks/usePaged.js';
import { useAsync } from '../../hooks/useAsync.js';
import { useToast } from '../../context/ToastContext.jsx';
import { errMsg, get, put } from '../../services/api.js';
import { PROJECT_STATUSES } from '../../utils/constants.js';
import { titleCase } from '../../utils/format.js';

const useLookups = () => useAsync(() => Promise.all([get('/departments'), get('/academic-terms'), get('/users', { role: 'supervisor', active: 'true', withWorkload: 1, limit: 100 })]), []);

export function CoordinatorProjectsPage() {
  const list = usePaged('/projects', { initialSort: undefined });
  const lk = useLookups();
  const [deps, terms] = lk.data || [[], []];
  const cols = [
    { key: 'title', header: 'Project', render: (p) => <><Link to={`/coordinator/projects/${p._id}`}><strong>{p.group?.name}</strong></Link><div className="muted small truncate" style={{ maxWidth: 320 }}>{p.title}</div></> },
    { key: 'dept', header: 'Dept', render: (p) => p.department?.code || '-' },
    { key: 'sup', header: 'Supervisor', render: (p) => p.supervisor?.name || <Badge tone="warning">Not assigned</Badge> },
    { key: 'status', header: 'Stage', render: (p) => <StatusBadge status={p.status} /> },
    { key: 'progress', header: 'Progress', render: (p) => <div style={{ minWidth: 110 }}><ProgressBar value={p.progress ?? 0} tone={p.overdue ? 'danger' : undefined} /><span className="muted small">{p.progress ?? 0}%{p.overdue ? ` - ${p.overdue} overdue` : ''}</span></div> },
  ];
  return (
    <>
      <PageHeader title="Project monitoring" subtitle="Every project in the programme, with its stage and progress." actions={<Button variant="secondary" to="/coordinator/analytics">Analytics</Button>} />
      <Card className="mb"><CardBody className="row">
        <SearchInput value={list.q} onChange={list.setQ} placeholder="Search project or group" />
        <Select aria-label="Stage" value={list.filters.status || ''} onChange={(e) => list.setFilter('status', e.target.value)} style={{ width: 190 }}><option value="">All stages</option>{PROJECT_STATUSES.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}</Select>
        <Select aria-label="Department" value={list.filters.department || ''} onChange={(e) => list.setFilter('department', e.target.value)} style={{ width: 170 }}><option value="">All departments</option>{deps.map((d) => <option key={d._id} value={d._id}>{d.name}</option>)}</Select>
        <Select aria-label="Term" value={list.filters.term || ''} onChange={(e) => list.setFilter('term', e.target.value)} style={{ width: 160 }}><option value="">All terms</option>{terms.map((t) => <option key={t._id} value={t._id}>{t.name}</option>)}</Select>
        <Select aria-label="Supervisor" value={list.filters.supervisor || ''} onChange={(e) => list.setFilter('supervisor', e.target.value)} style={{ width: 180 }}><option value="">Any supervisor</option><option value="none">Not assigned</option></Select>
      </CardBody></Card>
      <DataTable columns={cols} {...list} onPage={list.setPage} onRetry={list.reload} minWidth={720} />
    </>
  );
}

export function SupervisorAssignmentPage() {
  const toast = useToast();
  const list = usePaged('/projects', { initialFilters: { supervisor: 'none' } });
  const lk = useLookups();
  const supervisors = lk.data?.[2] || [];
  const [pick, setPick] = useState(null); // project
  const [sup, setSup] = useState('');
  const [capacity, setCapacity] = useState(null);
  const [busy, setBusy] = useState(false);

  const assign = async (force = false) => {
    setBusy(true);
    try {
      await put(`/projects/${pick._id}/supervisor`, { supervisorId: sup, force });
      toast.success('Supervisor assigned'); setPick(null); setSup(''); setCapacity(null); list.reload(); lk.reload();
    } catch (e) {
      if (e.code === 'CAPACITY_EXCEEDED' || e.response?.data?.code === 'CAPACITY_EXCEEDED') setCapacity(errMsg(e)); else toast.error(errMsg(e));
    } finally { setBusy(false); }
  };
  const cols = [
    { key: 'g', header: 'Group', render: (p) => <><strong>{p.group?.name}</strong><div className="muted small">{p.title}</div></> },
    { key: 'dept', header: 'Dept', render: (p) => p.department?.code || '-' },
    { key: 'status', header: 'Stage', render: (p) => <StatusBadge status={p.status} /> },
    { key: 'sup', header: 'Supervisor', render: (p) => p.supervisor?.name || <Badge tone="warning">Not assigned</Badge> },
    { key: 'a', header: '', render: (p) => <Button size="sm" variant={p.supervisor ? 'secondary' : 'primary'} onClick={() => { setPick(p); setSup(''); }}>{p.supervisor ? 'Reassign' : 'Assign'}</Button> },
  ];
  return (
    <>
      <PageHeader title="Supervisor assignment" subtitle="Assign or change the supervisor of a project. Students and the supervisor are notified." />
      <Card className="mb"><CardBody className="row">
        <SearchInput value={list.q} onChange={list.setQ} placeholder="Search project or group" />
        <Select aria-label="Show" value={list.filters.supervisor || ''} onChange={(e) => list.setFilter('supervisor', e.target.value)} style={{ width: 200 }}><option value="none">Waiting for a supervisor</option><option value="">All projects</option></Select>
      </CardBody></Card>
      <DataTable columns={cols} {...list} onPage={list.setPage} onRetry={list.reload} minWidth={640} />
      <Card className="mt"><CardBody><h3 style={{ marginTop: 0 }}>Supervisor workload</h3>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>{supervisors.map((s) => (<div key={s._id}><strong>{s.name}</strong><div className="muted small">{s.workload || 0} / {s.maxProjects || '-'} projects</div><ProgressBar value={s.maxProjects ? Math.round(((s.workload || 0) / s.maxProjects) * 100) : 0} tone={s.maxProjects && s.workload >= s.maxProjects ? 'danger' : undefined} /></div>))}</div></CardBody></Card>
      {pick && !capacity && (
        <Modal title={`${pick.supervisor ? 'Reassign' : 'Assign'} supervisor`} onClose={() => setPick(null)} footer={<><Button variant="secondary" onClick={() => setPick(null)}>Cancel</Button><Button disabled={!sup} loading={busy} onClick={() => assign(false)}>Assign</Button></>}>
          <p style={{ marginTop: 0 }}><strong>{pick.group?.name}</strong> - {pick.title}</p>
          <Field label="Supervisor"><Select value={sup} onChange={(e) => setSup(e.target.value)}><option value="">Select a supervisor...</option>{supervisors.map((s) => <option key={s._id} value={s._id}>{s.name} ({s.workload || 0}/{s.maxProjects || '-'})</option>)}</Select></Field>
          {pick.supervisor && <Alert tone="info" className="mt">Currently supervised by {pick.supervisor.name}. The change is kept in the project's supervisor history.</Alert>}
        </Modal>)}
      {capacity && <ConfirmDialog danger title="Supervisor is at capacity" message={capacity} confirmLabel="Assign anyway" loading={busy} onClose={() => { setCapacity(null); }} onConfirm={() => assign(true)} />}
    </>
  );
}
