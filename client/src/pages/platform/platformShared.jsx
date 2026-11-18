import { useState } from 'react';
import { Copy, KeyRound, MailCheck, MailQuestion, UserCheck, UserX } from 'lucide-react';
import { Alert, Badge, Button } from '../../components/common/ui.jsx';
import { Modal } from '../../components/common/Modal.jsx';
import { Field, TextArea } from '../../components/forms/fields.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { errMsg, post } from '../../services/api.js';

export const TYPE = { university: 'University', college: 'College', school: 'School', institute: 'Institute', training_center: 'Training centre', other: 'Other' };
export const STATUS_TONE = { pending: 'warning', approved: 'success', rejected: 'danger', suspended: 'danger', deleted: 'danger' };
export const STATUS_LABEL = { pending: 'Waiting for email verification', approved: 'Active', rejected: 'Rejected', suspended: 'Suspended', deleted: 'Deleted by coordinator' };

export const DECISIONS = {
  approve: { title: 'Activate this institution?', label: 'Activate', done: 'activated', body: 'Its coordinator can log in right away (you are vouching for them without the email check).', note: false },
  reject: { title: 'Reject this institution?', label: 'Reject', done: 'rejected', body: 'The coordinator cannot log in. The name can be registered again later.', note: true, danger: true },
  suspend: { title: 'Suspend this institution?', label: 'Suspend', done: 'suspended', body: 'Everyone at this institution is blocked immediately, including people who are logged in. Nothing is deleted and you can reactivate it any time.', note: true, danger: true },
  reactivate: { title: 'Reactivate this institution?', label: 'Reactivate', done: 'reactivated', body: 'Its people can log in again.', note: false },
  restore: { title: 'Restore this institution?', label: 'Restore', done: 'restored', body: 'Its coordinator deleted it. Restoring brings everything back and lets its people log in again.', note: false },
  purge: { title: 'Erase this institution for good?', label: 'Erase for good', done: 'erased for good', body: 'All its users, projects, reports and uploaded files are permanently erased now. This cannot be undone.', note: false, danger: true },
};

/** Which decisions make sense for which status. */
export const ACTIONS_FOR = {
  pending: ['approve', 'reject', 'purge'], approved: ['suspend', 'purge'], rejected: ['approve', 'purge'], suspended: ['reactivate', 'purge'], deleted: ['restore', 'purge'],
};

export function DecisionDialog({ inst, decision, onClose, onDone }) {
  const toast = useToast();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const c = DECISIONS[decision];
  const submit = async () => {
    setBusy(true);
    try {
      await post(`/platform/institutions/${inst._id}/decision`, { decision, note: note.trim() || undefined });
      toast.success(`${inst.name}: ${c.done}`);
      onDone?.(decision);
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Modal title={c.title} onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant={c.danger ? 'danger' : 'primary'} loading={busy} onClick={submit}>{c.label}</Button></>}>
      <div className="stack">
        <p style={{ margin: 0 }}><strong>{inst.name}</strong></p>
        <p className="muted" style={{ margin: 0 }}>{c.body}</p>
        {c.note && <Field label="Note (optional)" help="Shown to the coordinator"><TextArea rows={2} value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} /></Field>}
      </div>
    </Modal>
  );
}

/** A temporary password is shown exactly once: copy it now. */
export function TempPasswordDialog({ title = 'Temporary password', email, password, emailed, onClose }) {
  const toast = useToast();
  const copy = async () => { try { await navigator.clipboard.writeText(password); toast.success('Copied'); } catch { toast.error('Could not copy - select it and copy by hand'); } };
  return (
    <Modal title={title} onClose={onClose} footer={<Button onClick={onClose}>I have saved it</Button>}>
      <div className="stack">
        <Alert tone="warning">This password is shown <strong>only once</strong>. {emailed ? 'It was also emailed to the person.' : 'Email is not configured (or failed), so give it to them yourself.'} They must choose their own password at the first login.</Alert>
        <div className="small muted">Account: {email}</div>
        <div className="row" style={{ gap: 8 }}>
          <code style={{ fontSize: '1.1rem', padding: '8px 12px', background: 'var(--surface-2, #f1f5f9)', borderRadius: 8, userSelect: 'all' }} data-testid="temp-password">{password}</code>
          <Button size="sm" variant="secondary" icon={Copy} onClick={copy}>Copy</Button>
        </div>
      </div>
    </Modal>
  );
}

/** Shown after an invitation: tells the admin whether the email went out, and gives the link when it did not. */
export function InviteLinkDialog({ title = 'Invitation', email, emailed, link, onClose }) {
  const toast = useToast();
  const copy = async () => { try { await navigator.clipboard.writeText(link); toast.success('Link copied'); } catch { toast.error('Could not copy - select the link and copy by hand'); } };
  return (
    <Modal title={title} onClose={onClose} footer={<Button onClick={onClose}>Done</Button>}>
      <div className="stack">
        {emailed
          ? <Alert tone="success">An email with a set-password link was sent to <strong>{email}</strong>. The link works for 7 days. They choose their own password; nobody else ever sees it.</Alert>
          : <Alert tone="warning">The email could not be sent (email is not set up on the server, or it failed). Send this link to <strong>{email}</strong> yourself. It works for 7 days and only once.</Alert>}
        {!emailed && link && (
          <div className="row" style={{ gap: 8 }}>
            <code style={{ fontSize: '.8rem', padding: '8px 12px', background: 'var(--surface-2, #f1f5f9)', borderRadius: 8, userSelect: 'all', wordBreak: 'break-all', flex: 1 }} data-testid="invite-link">{link}</code>
            <Button size="sm" variant="secondary" icon={Copy} onClick={copy}>Copy</Button>
          </div>
        )}
      </div>
    </Modal>
  );
}

const COORD_ACTIONS = {
  'reset-password': { title: 'Send a password reset link?', label: 'Send link', body: 'A set-password link is emailed to them. Their current sessions end at once and they choose a new password themselves.' },
  'resend-invitation': { title: 'Send the invitation again?', label: 'Send invitation', body: 'The old invitation link stops working and a new one is emailed to them.' },
  deactivate: { title: 'Deactivate this coordinator?', label: 'Deactivate', danger: true, body: 'They are logged out immediately and cannot log in until you reactivate them. Their institution and its data stay as they are.' },
  reactivate: { title: 'Reactivate this coordinator?', label: 'Reactivate', body: 'They can log in again.' },
  'resend-verification': { title: 'Send the verification email again?', label: 'Send email', body: 'A new verification link is emailed to them.' },
  'verify-email': { title: 'Mark the email as verified?', label: 'Mark as verified', body: 'Use this only when you know the address is theirs (for example, the verification email cannot be delivered). If their institution was waiting for this check, it becomes active.' },
};

/** Buttons for one coordinator (used on the institution page and on the Coordinators page). */
export function CoordinatorActions({ c, onDone }) {
  const toast = useToast();
  const [dlg, setDlg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState(null);
  const run = async () => {
    setBusy(true);
    try {
      const r = await post(`/platform/coordinators/${c._id}/action`, { action: dlg });
      if (dlg === 'reset-password' || dlg === 'resend-invitation') setLink({ emailed: r.emailed, link: r.link });
      else if (dlg === 'resend-verification') toast[r.emailed ? 'success' : 'info'](r.limited ? 'Please wait a minute before sending another email' : r.emailed ? 'Verification email sent' : 'Email is not configured on the server, so nothing was sent');
      else toast.success(dlg === 'verify-email' && r.activated ? 'Email verified and the institution is now active' : 'Done');
      setDlg(null); onDone?.();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  const btn = (action, icon, text) => <Button size="sm" variant="ghost" icon={icon} onClick={() => setDlg(action)}>{text}</Button>;
  return (
    <>
      <span className="row" style={{ gap: 2 }}>
        {c.invitePending ? btn('resend-invitation', MailQuestion, 'Resend invitation') : btn('reset-password', KeyRound, 'Reset password')}
        {c.isActive ? btn('deactivate', UserX, 'Deactivate') : btn('reactivate', UserCheck, 'Reactivate')}
        {!c.emailVerified && !c.invitePending && <>{btn('resend-verification', MailQuestion, 'Resend email')}{btn('verify-email', MailCheck, 'Mark verified')}</>}
      </span>
      {dlg && (
        <Modal title={COORD_ACTIONS[dlg].title} onClose={() => setDlg(null)} footer={<><Button variant="secondary" onClick={() => setDlg(null)}>Cancel</Button><Button variant={COORD_ACTIONS[dlg].danger ? 'danger' : 'primary'} loading={busy} onClick={run}>{COORD_ACTIONS[dlg].label}</Button></>}>
          <div className="stack"><p style={{ margin: 0 }}><strong>{c.name}</strong> ({c.email})</p><p className="muted" style={{ margin: 0 }}>{COORD_ACTIONS[dlg].body}</p></div>
        </Modal>
      )}
      {link && <InviteLinkDialog title="Link sent" email={c.email} emailed={link.emailed} link={link.link} onClose={() => setLink(null)} />}
    </>
  );
}

export const CoordinatorBadges = ({ c }) => (
  <span className="row" style={{ gap: 4 }}>
    {c.isActive ? <Badge tone="success">active</Badge> : <Badge tone="danger">inactive</Badge>}
    {c.invitePending ? <Badge tone="warning">invited - not accepted yet</Badge> : !c.emailVerified && <Badge tone="warning">email not verified</Badge>}
    {c.coordinatorLevel === 'department' ? <Badge tone="info">department{c.department?.name ? `: ${c.department.name}` : ''}</Badge> : <Badge tone="info">institution level</Badge>}
  </span>
);
