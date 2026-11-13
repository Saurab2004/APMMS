import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Copy, Crown, LogIn, LogOut, Mail, UserMinus, UserPlus, UsersRound, X, Check } from 'lucide-react';
import { Alert, Badge, Button, Card, CardBody, CardHead, EmptyState, KV, Loading, PageHeader, StatusBadge, ErrorState } from '../../components/common/ui.jsx';
import { ConfirmDialog } from '../../components/common/Modal.jsx';
import { Field, Input } from '../../components/forms/fields.jsx';
import DataTable from '../../components/tables/DataTable.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { useToast } from '../../context/ToastContext.jsx';
import { del, errMsg, get, post } from '../../services/api.js';
import { fmtDate } from '../../utils/format.js';
import Hint from '../../components/onboarding/Hint.jsx';

export const useMyGroups = () => useAsync(() => get('/groups/mine'), []);

export function GroupManagePage() {
  const state = useMyGroups();
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(null);
  if (state.loading && !state.data) return <Loading />;
  if (state.error && !state.data) return <ErrorState message={state.error} onRetry={state.reload} />;
  const { current, outgoingInvitations } = state.data;

  if (!current) return (
    <>
      <PageHeader title="Group management" />
      <Hint id="student.group" />
      <div className="row mb"><Button size="sm" variant="secondary" to="/student/invitations">Invitations</Button><Button size="sm" variant="secondary" to="/student/group/join">Join with a code</Button><Button size="sm" variant="secondary" to="/student/groups/past">Past groups</Button></div>
      <Card><EmptyState icon={UsersRound} title="You are not in a group yet" action={<div className="row" style={{ justifyContent: 'center' }}><Button to="/student/group/create">Create a group</Button><Button variant="secondary" to="/student/group/join">Join with a code</Button></div>}>
        Create a group and invite classmates, or join one with a group code.</EmptyState></Card>
    </>
  );
  const { group, project, myRole } = current;
  const leader = myRole === 'leader';
  const members = group.members.filter((m) => m.status === 'active');

  const act = async (fn, okMsg) => { setBusy(true); try { await fn(); toast.success(okMsg); setConfirm(null); await state.reload(); } catch (e) { toast.error(errMsg(e)); setConfirm(null); } finally { setBusy(false); } };
  const invite = (e) => { e.preventDefault(); act(async () => { await post(`/groups/${group._id}/invite`, { email }); setEmail(''); }, 'Invitation sent'); };

  return (
    <>
      <PageHeader title={group.name} subtitle={`${group.term?.name} - ${group.department?.name}`} actions={!leader || members.length > 1 ? <Button variant="secondary" icon={LogOut} onClick={() => setConfirm({ title: 'Leave group', msg: leader ? 'Leadership must be transferred before you can leave.' : 'You will lose access to this group\'s project.', run: () => act(() => post(`/groups/${group._id}/leave`), 'You left the group'), disabled: leader })}>Leave group</Button> : null} />
      <Hint id="student.group" />
      <div className="row mb"><Button size="sm" variant="secondary" to="/student/invitations">Invitations</Button><Button size="sm" variant="secondary" to="/student/group/join">Join with a code</Button><Button size="sm" variant="secondary" to="/student/groups/past">Past groups</Button></div>
      <div className="grid" style={{ gridTemplateColumns: 'minmax(0,2fr) minmax(0,1fr)', alignItems: 'start' }}>
        <div className="stack" style={{ minWidth: 0 }}>
          <Card><CardHead title={`Members (${members.length})`} /><div className="table-wrap"><table className="table" style={{ minWidth: 480 }}>
            <thead><tr><th>Name</th><th>Student ID</th><th>Role</th>{leader && <th />}</tr></thead>
            <tbody>{members.map((m) => (
              <tr key={m.user._id}><td><strong>{m.user.name}</strong><div className="sub">{m.user.email}</div></td><td>{m.user.studentId}</td><td><StatusBadge status={m.role} /></td>
                {leader && <td className="actions">{m.role !== 'leader' && <span className="row" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                  <Button size="sm" variant="secondary" icon={Crown} onClick={() => setConfirm({ title: 'Transfer leadership', msg: `Make ${m.user.name} the Group Leader? You will become a regular member and lose official submission rights.`, run: () => act(() => post(`/groups/${group._id}/transfer-leadership`, { userId: m.user._id }), 'Leadership transferred') })}>Make leader</Button>
                  <Button size="sm" variant="ghost" icon={UserMinus} aria-label={`Remove ${m.user.name}`} onClick={() => setConfirm({ title: 'Remove member', danger: true, msg: `Remove ${m.user.name} from the group?`, run: () => act(() => post(`/groups/${group._id}/remove-member`, { userId: m.user._id }), 'Member removed') })} /></span>}</td>}
              </tr>))}</tbody></table></div></Card>

          {leader && <Card><CardHead title="Invite a classmate" icon={UserPlus} /><CardBody className="stack">
            <form className="row" style={{ alignItems: 'flex-end', flexWrap: 'nowrap' }} onSubmit={invite}>
              <div className="grow"><Field label="Student email" help="They must have an active account in your department."><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field></div>
              <Button type="submit" icon={Mail} loading={busy} disabled={!email}>Invite</Button>
            </form>
            {outgoingInvitations?.length > 0 && <div><div className="label small muted">Pending invitations</div><ul className="list">{outgoingInvitations.map((i) => (
              <li key={i._id} className="row between"><span>{i.invitedUser?.name} <span className="muted small">{i.invitedUser?.email} - expires {fmtDate(i.expiresAt)}</span></span>
                <Button variant="ghost" size="sm" icon={X} onClick={() => act(() => del(`/groups/invitations/${i._id}`), 'Invitation cancelled')}>Cancel</Button></li>))}</ul></div>}
          </CardBody></Card>}
        </div>
        <div className="stack" style={{ minWidth: 0 }}>
          <Card><CardHead title="Group code" /><CardBody className="stack">
            <p className="muted small" style={{ margin: 0 }}>Share this code so classmates can join (until the group is full).</p>
            <div className="row"><code style={{ fontSize: '1.4rem', letterSpacing: '.15em', padding: '6px 12px' }}>{group.code}</code>
              <Button variant="secondary" size="sm" icon={Copy} onClick={() => { navigator.clipboard?.writeText(group.code); toast.success('Code copied'); }}>Copy</Button></div>
          </CardBody></Card>
          <Card><CardHead title="Project" /><CardBody><KV items={[['Title', project?.title], ['Status', project && <StatusBadge status={project.status} />], ['Supervisor', project?.supervisor?.name || 'Not assigned yet'], ['Your role', <StatusBadge key="r" status={myRole} />]]} /></CardBody></Card>
        </div>
      </div>
      {confirm && <ConfirmDialog title={confirm.title} danger={confirm.danger} loading={busy} message={confirm.msg} confirmLabel="Confirm" onConfirm={confirm.disabled ? () => setConfirm(null) : confirm.run} onClose={() => setConfirm(null)} />}
      <style>{`@media (max-width: 960px) { .grid[style*='2fr'] { grid-template-columns: minmax(0,1fr) !important; } }`}</style>
    </>
  );
}

export function CreateGroupPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError('');
    try { await post('/groups', { name }); toast.success('Group created - you are the Group Leader'); navigate('/student/group'); } catch (err) { setError(errMsg(err)); } finally { setBusy(false); }
  };
  return (
    <>
      <PageHeader title="Create a group" subtitle="You become the Group Leader and can invite classmates afterwards." />
      <Card style={{ maxWidth: 520 }}><CardBody>
        {error && <Alert tone="danger" className="mb">{error}</Alert>}
        <form className="stack" onSubmit={submit}><Field label="Group name" required help="3-80 characters, unique within the current semester."><Input value={name} onChange={(e) => setName(e.target.value)} minLength={3} maxLength={80} required /></Field>
          <div><Button type="submit" icon={UserPlus} loading={busy} disabled={name.trim().length < 3}>Create group</Button></div></form>
      </CardBody></Card>
    </>
  );
}

export function JoinGroupPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError('');
    try { await post('/groups/join', { code }); toast.success('You joined the group'); navigate('/student/group'); } catch (err) { setError(errMsg(err)); } finally { setBusy(false); }
  };
  return (
    <>
      <PageHeader title="Join a group" subtitle="Ask your Group Leader for the 6-character group code." />
      <Card style={{ maxWidth: 520 }}><CardBody>
        {error && <Alert tone="danger" className="mb">{error}</Alert>}
        <form className="stack" onSubmit={submit}><Field label="Group code" required><Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={12} style={{ letterSpacing: '.2em', textTransform: 'uppercase' }} required /></Field>
          <div><Button type="submit" icon={LogIn} loading={busy} disabled={code.length < 4}>Join group</Button></div></form>
      </CardBody></Card>
    </>
  );
}

export function InvitationsPage() {
  const state = useMyGroups();
  const toast = useToast();
  const navigate = useNavigate();
  const [busy, setBusy] = useState('');
  if (state.loading && !state.data) return <Loading />;
  if (state.error && !state.data) return <ErrorState message={state.error} onRetry={state.reload} />;
  const list = state.data.incomingInvitations;
  const respond = async (i, accept) => {
    setBusy(i._id + accept);
    try { await post(`/groups/invitations/${i._id}/respond`, { accept }); toast.success(accept ? 'You joined the group' : 'Invitation declined'); if (accept) navigate('/student/group'); else state.reload(); } catch (e) { toast.error(errMsg(e)); state.reload(); } finally { setBusy(''); }
  };
  return (
    <>
      <PageHeader title="Invitations" subtitle="Group invitations sent to you." />
      {!list.length ? <Card><EmptyState icon={Mail} title="No pending invitations" /></Card> : (
        <div className="stack">{list.map((i) => (
          <Card key={i._id}><CardBody className="row between">
            <div><h3>{i.group?.name}</h3><div className="muted small">Invited by {i.invitedBy?.name} - expires {fmtDate(i.expiresAt)}</div></div>
            <div className="row"><Button icon={Check} loading={busy === i._id + true} onClick={() => respond(i, true)}>Accept</Button><Button variant="secondary" icon={X} loading={busy === i._id + false} onClick={() => respond(i, false)}>Decline</Button></div>
          </CardBody></Card>))}</div>
      )}
    </>
  );
}

export function PastGroupsPage() {
  const state = useMyGroups();
  if (state.loading && !state.data) return <Loading />;
  if (state.error && !state.data) return <ErrorState message={state.error} onRetry={state.reload} />;
  const columns = [
    { key: 'name', header: 'Group', render: (g) => <strong>{g.name}</strong> },
    { key: 'term', header: 'Semester', render: (g) => g.term?.name },
    { key: 'project', header: 'Project', render: (g) => g.project?.title || '-' },
    { key: 'myRole', header: 'My role', render: (g) => <StatusBadge status={g.myRole} /> },
    { key: 'myStatus', header: 'Membership', render: (g) => <StatusBadge status={g.myStatus} /> },
    { key: 'joinedAt', header: 'Joined', render: (g) => fmtDate(g.joinedAt) },
    { key: 'leftAt', header: 'Left', render: (g) => fmtDate(g.leftAt) },
  ];
  return (<><PageHeader title="Past groups" subtitle="Your membership history." /><DataTable columns={columns} rows={state.data.past} empty={<EmptyState icon={UsersRound} title="No past groups" />} /></>);
}
