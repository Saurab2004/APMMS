import { useState } from 'react';
import { Archive, Crown, UserMinus, UserPlus } from 'lucide-react';
import { Badge, Button, Card, CardBody, IconButton, PageHeader, StatusBadge } from '../../components/common/ui.jsx';
import DataTable from '../../components/tables/DataTable.jsx';
import { ConfirmDialog, Modal } from '../../components/common/Modal.jsx';
import { Check, Field, Input, SearchInput, Select } from '../../components/forms/fields.jsx';
import { usePaged } from '../../hooks/usePaged.js';
import { useAsync } from '../../hooks/useAsync.js';
import { useToast } from '../../context/ToastContext.jsx';
import { errMsg, get, getPaged, patch } from '../../services/api.js';

function ManageGroup({ group, onClose, onChanged }) {
  const toast = useToast();
  const [move, setMove] = useState(false);
  const [busy, setBusy] = useState('');
  const [confirm, setConfirm] = useState(null);
  const members = (group.members || []).filter((m) => m.status === 'active');
  const run = async (key, body) => {
    setBusy(key);
    try { await patch(`/groups/${group._id}/admin`, body); toast.success('Group updated'); onChanged(); setConfirm(null); if (body.action === 'archive') onClose(); }
    catch (e) { toast.error(errMsg(e)); } finally { setBusy(''); }
  };
  return (
    <Modal wide title={`Manage ${group.name}`} onClose={onClose} footer={<Button variant="secondary" onClick={onClose}>Close</Button>}>
      <div className="stack">
        <h3 style={{ margin: 0 }}>Active members</h3>
        <ul className="list">{members.map((m) => (
          <li key={m.user?._id} className="row between">
            <span><strong>{m.user?.name}</strong> <span className="muted small">{m.user?.email}</span> {m.role === 'leader' && <Badge tone="indigo">Leader</Badge>}</span>
            <span className="row" style={{ gap: 2 }}>
              {m.role !== 'leader' && <IconButton icon={Crown} label={`Make ${m.user?.name} leader`} onClick={() => run('lead', { action: 'set_leader', userId: m.user._id })} />}
              <IconButton icon={UserMinus} label={`Remove ${m.user?.name}`} onClick={() => setConfirm({ title: 'Remove member?', message: `${m.user?.name} will be removed from ${group.name}.`, body: { action: 'remove_member', userId: m.user._id } })} />
            </span>
          </li>))}</ul>
        <AddMember groupId={group._id} onDone={onChanged} move={move} setMove={setMove} />
        {group.status === 'active' && <div><Button variant="danger" icon={Archive} onClick={() => setConfirm({ title: 'Archive group?', message: 'The group becomes read-only history. Members become free to join another group.', body: { action: 'archive' } })}>Archive group</Button></div>}
      </div>
      {confirm && <ConfirmDialog danger title={confirm.title} message={confirm.message} loading={!!busy} confirmLabel="Confirm" onClose={() => setConfirm(null)} onConfirm={() => run('c', confirm.body)} />}
    </Modal>
  );
}

function AddMember({ groupId, onDone, move, setMove }) {
  const toast = useToast();
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      const { items } = await getPaged('/users', { q: q.trim(), role: 'student', active: 'true', limit: 5 });
      const exact = items.find((u) => u.email.toLowerCase() === q.trim().toLowerCase() || u.studentId === q.trim());
      if (!exact) { toast.error('No active student matches that email or student ID'); return; }
      await patch(`/groups/${groupId}/admin`, { action: 'add_member', userId: exact._id, moveFromOtherGroup: move });
      toast.success(`${exact.name} added`); setQ(''); onDone();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <div className="stack-sm">
      <h3 style={{ margin: 0 }}>Add a student</h3>
      <div className="row"><Input aria-label="Student email or ID" placeholder="Student email or student ID" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 320 }} /><Button icon={UserPlus} loading={busy} disabled={!q.trim()} onClick={submit}>Add</Button></div>
      <Check label="Move the student out of their current group if they are in one" checked={move} onChange={(e) => setMove(e.target.checked)} />
    </div>
  );
}

export default function GroupsAdminPage() {
  const list = usePaged('/groups', { initialFilters: { status: 'active' } });
  const deps = useAsync(() => get('/departments'), []);
  const batches = useAsync(() => get('/batches'), []);
  const [managing, setManaging] = useState(null);
  const cols = [
    { key: 'name', header: 'Group', render: (g) => <><strong>{g.name}</strong><div className="muted small">Code {g.code}</div></> },
    { key: 'members', header: 'Members', render: (g) => (g.members || []).filter((m) => m.status === 'active').map((m) => m.user?.name).join(', ') || '-' },
    { key: 'dept', header: 'Dept', render: (g) => g.department?.code || '-' },
    { key: 'term', header: 'Batch / term', render: (g) => <>{g.batch?.name || '-'}<div className="muted small">{g.term?.name || '-'}</div></> },
    { key: 'sup', header: 'Supervisor', render: (g) => g.project?.supervisor?.name || <Badge tone="warning">Not assigned</Badge> },
    { key: 'status', header: 'Status', render: (g) => <StatusBadge status={g.status} /> },
    { key: 'a', header: '', render: (g) => <Button size="sm" variant="secondary" onClick={() => setManaging(g._id)}>Manage</Button> },
  ];
  const current = list.rows?.find((g) => g._id === managing);
  return (
    <>
      <PageHeader title="Groups" subtitle="Students normally manage their own groups. Use this page to fix problems." />
      <Card className="mb"><CardBody className="row">
        <SearchInput value={list.q} onChange={list.setQ} placeholder="Search group name" />
        <Select aria-label="Status" value={list.filters.status || ''} onChange={(e) => list.setFilter('status', e.target.value)} style={{ width: 150 }}><option value="">Any status</option><option value="active">Active</option><option value="archived">Archived</option><option value="dissolved">Dissolved</option></Select>
        <Select aria-label="Department" value={list.filters.department || ''} onChange={(e) => list.setFilter('department', e.target.value)} style={{ width: 180 }}><option value="">All departments</option>{(deps.data || []).map((d) => <option key={d._id} value={d._id}>{d.name}</option>)}</Select>
        <Select aria-label="Batch" value={list.filters.batch || ''} onChange={(e) => list.setFilter('batch', e.target.value)} style={{ width: 190 }}><option value="">All batches</option>{(batches.data || []).map((b) => <option key={b._id} value={b._id}>{b.name} ({b.department?.code})</option>)}</Select>
        <Check label="Without supervisor" checked={list.filters.noSupervisor === '1'} onChange={(e) => list.setFilter('noSupervisor', e.target.checked ? '1' : '')} />
      </CardBody></Card>
      <DataTable columns={cols} {...list} onPage={list.setPage} onRetry={list.reload} minWidth={760} />
      {current && <ManageGroup group={current} onClose={() => setManaging(null)} onChanged={list.reload} />}
    </>
  );
}
