import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Building2, Check, Crown, Pause, Play, X } from 'lucide-react';
import { Alert, Badge, Button, Card, CardBody, EmptyState, ErrorState, Loading, PageHeader } from '../../components/common/ui.jsx';
import { Modal } from '../../components/common/Modal.jsx';
import { Field, Select, TextArea } from '../../components/forms/fields.jsx';
import Hint from '../../components/onboarding/Hint.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { useToast } from '../../context/ToastContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { errMsg, get, post } from '../../services/api.js';
import { fmtDate } from '../../utils/format.js';

const TONE = { pending: 'warning', approved: 'success', rejected: 'danger', suspended: 'danger', deleted: 'danger' };
const DONE = { approve: 'approved', reject: 'rejected', suspend: 'suspended', reactivate: 'reactivated', restore: 'restored', purge: 'erased for good' };
const TYPE = { university: 'University', college: 'College', school: 'School', institute: 'Institute', training_center: 'Training centre', other: 'Other' };
const COPY = {
  approve: { title: 'Approve this institution?', label: 'Approve', body: 'Its coordinator will be able to log in and set up the institution. They are emailed if email is configured.', note: false },
  reject: { title: 'Reject this request?', label: 'Reject', body: 'The coordinator cannot log in. The name can be requested again later.', note: true, danger: true },
  suspend: { title: 'Suspend this institution?', label: 'Suspend', body: 'Everyone at this institution is blocked immediately. Nothing is deleted, and you can reactivate it any time.', note: true, danger: true },
  restore: { title: 'Restore this institution?', label: 'Restore', body: 'Its coordinator deleted it. Restoring brings everything back and lets its people log in again.', note: false },
  purge: { title: 'Erase this institution for good?', label: 'Erase for good', body: 'All its users, projects, reports and files are permanently erased now. This cannot be undone.', note: false, danger: true },
  reactivate: { title: 'Reactivate this institution?', label: 'Reactivate', body: 'Its people can log in again.', note: false },
};

/** Platform owner only: approve, reject and suspend institutions. */
export default function InstitutionsPage() {
  const { user } = useAuth();
  if (!user.isPlatformOwner) return <Navigate to="/coordinator" replace />;
  return <InstitutionsList />;
}

function InstitutionsList() {
  const toast = useToast();
  const [status, setStatus] = useState('');
  const list = useAsync(() => get(`/institutions${status ? `?status=${status}` : ''}`), [status]);
  const [dlg, setDlg] = useState(null); // { inst, decision }
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [owner, setOwner] = useState(null); // coordinator to promote

  const decide = async () => {
    setBusy(true);
    try {
      await post(`/institutions/${dlg.inst._id}/decision`, { decision: dlg.decision, note: note.trim() || undefined });
      toast.success(`${dlg.inst.name}: ${DONE[dlg.decision]}`);
      setDlg(null); setNote(''); list.reload();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  const promote = async () => {
    setBusy(true);
    try { await post('/institutions/platform-owner', { userId: owner._id }); toast.success(`${owner.name} can now approve institutions`); setOwner(null); list.reload(); }
    catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };

  const items = list.data || [];
  const pending = items.filter((i) => i.status === 'pending').length;
  return (
    <>
      <PageHeader title="Institutions" subtitle="Every university, college or school is its own separate workspace. You approve who may join." />
      <Hint id="coordinator.institutions" />
      <Card className="mb"><CardBody className="row">
        <Select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: 190 }}>
          <option value="">All institutions</option><option value="pending">Waiting for approval</option><option value="approved">Approved</option><option value="suspended">Suspended</option><option value="rejected">Rejected</option><option value="deleted">Deleted</option>
        </Select>
        {pending > 0 && !status && <Badge tone="warning">{pending} waiting</Badge>}
      </CardBody></Card>
      {list.loading && !list.data ? <Loading /> : list.error ? <ErrorState message={list.error} onRetry={list.reload} /> : items.length === 0 ? (
        <EmptyState icon={Building2} title="No institutions here">When a coordinator registers a new institution it appears here for your approval.</EmptyState>
      ) : (
        <div className="stack">
          {items.map((i) => (
            <Card key={i._id}><CardBody className="stack">
              <div className="row between wrap">
                <div>
                  <strong>{i.name}</strong> <Badge tone={TONE[i.status]}>{i.status}</Badge> {i.isMine && <Badge tone="info">Your institution</Badge>}
                  <div className="muted small">{TYPE[i.type] || i.type} - requested {fmtDate(i.createdAt)} - {i.counts.students} students, {i.counts.supervisors} supervisors</div>
                  {i.statusNote && <div className="muted small">Note: {i.statusNote}</div>}
                  {i.status === 'deleted' && i.purgeAt && <div className="small" style={{ color: 'var(--danger)' }}>Deleted by its coordinator. Erased for good on {fmtDate(i.purgeAt)} unless you restore it.</div>}
                </div>
                {!i.isMine && (
                  <div className="row">
                    {i.status === 'pending' && <><Button size="sm" icon={Check} onClick={() => { setDlg({ inst: i, decision: 'approve' }); setNote(''); }}>Approve</Button><Button size="sm" variant="secondary" icon={X} onClick={() => { setDlg({ inst: i, decision: 'reject' }); setNote(''); }}>Reject</Button></>}
                    {i.status === 'rejected' && <Button size="sm" variant="secondary" icon={Check} onClick={() => { setDlg({ inst: i, decision: 'approve' }); setNote(''); }}>Approve after all</Button>}
                    {i.status === 'approved' && <Button size="sm" variant="secondary" icon={Pause} onClick={() => { setDlg({ inst: i, decision: 'suspend' }); setNote(''); }}>Suspend</Button>}
                    {i.status === 'deleted' && <><Button size="sm" icon={Play} onClick={() => { setDlg({ inst: i, decision: 'restore' }); setNote(''); }}>Restore</Button><Button size="sm" variant="secondary" icon={X} onClick={() => { setDlg({ inst: i, decision: 'purge' }); setNote(''); }}>Erase for good</Button></>}
                    {i.status === 'suspended' && <Button size="sm" icon={Play} onClick={() => { setDlg({ inst: i, decision: 'reactivate' }); setNote(''); }}>Reactivate</Button>}
                  </div>
                )}
              </div>
              <div className="small">
                <span className="muted">Coordinator{i.coordinators.length === 1 ? '' : 's'}: </span>
                {i.coordinators.map((c) => (
                  <span key={c._id} style={{ marginRight: 14 }}>
                    {c.name} ({c.email}){!c.emailVerified && <> <Badge tone="warning">email not verified</Badge></>}{c.isPlatformOwner && <> <Badge tone="info"><Crown size={11} aria-hidden="true" /> platform owner</Badge></>}
                    {i.status === 'approved' && c.approvalStatus === 'approved' && c.isActive && !c.isPlatformOwner && <> <Button size="sm" variant="ghost" onClick={() => setOwner(c)} title="Let this coordinator approve institutions too">Make platform owner</Button></>}
                  </span>
                ))}
              </div>
            </CardBody></Card>
          ))}
        </div>
      )}
      {dlg && (
        <Modal title={COPY[dlg.decision].title} onClose={() => setDlg(null)} footer={<><Button variant="secondary" onClick={() => setDlg(null)}>Cancel</Button><Button variant={COPY[dlg.decision].danger ? 'danger' : 'primary'} loading={busy} onClick={decide}>{COPY[dlg.decision].label}</Button></>}>
          <div className="stack">
            <p style={{ margin: 0 }}><strong>{dlg.inst.name}</strong></p>
            <p className="muted" style={{ margin: 0 }}>{COPY[dlg.decision].body}</p>
            {COPY[dlg.decision].note && <Field label="Note (optional)" help="Shown to the coordinator"><TextArea rows={2} value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} /></Field>}
          </div>
        </Modal>
      )}
      {owner && (
        <Modal title="Make platform owner?" onClose={() => setOwner(null)} footer={<><Button variant="secondary" onClick={() => setOwner(null)}>Cancel</Button><Button loading={busy} onClick={promote}>Make platform owner</Button></>}>
          <Alert tone="warning">{owner.name} will be able to approve, reject and suspend every institution on this platform. Only do this for someone you fully trust.</Alert>
        </Modal>
      )}
    </>
  );
}
