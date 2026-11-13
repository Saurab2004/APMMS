import { useNavigate } from 'react-router-dom';
import { Bell, CheckCheck } from 'lucide-react';
import { Button, Card, EmptyState, PageHeader } from '../../components/common/ui.jsx';
import DataState from '../../components/common/DataState.jsx';
import { Pagination } from '../../components/tables/DataTable.jsx';
import { usePaged } from '../../hooks/usePaged.js';
import { api, errMsg } from '../../services/api.js';
import { useSocket } from '../../context/SocketContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { timeAgo } from '../../utils/format.js';
import { Select } from '../../components/forms/fields.jsx';

export default function NotificationsPage() {
  const list = usePaged('/notifications', { limit: 20 });
  const { refreshUnread } = useSocket();
  const toast = useToast();
  const navigate = useNavigate();
  const { user } = useAuth();

  const open = async (n) => {
    if (!n.readAt) { try { await api.patch(`/notifications/${n._id}/read`); refreshUnread(); } catch { /* ignore */ } }
    if (n.link) navigate(n.link.startsWith('/notifications') ? `/${user.role}/notifications` : n.link);
    else list.reload();
  };
  const markAll = async () => {
    try { await api.post('/notifications/read-all'); toast.success('All notifications marked as read'); refreshUnread(); list.reload(); } catch (e) { toast.error(errMsg(e)); }
  };

  return (
    <>
      <PageHeader title="Notifications" subtitle="Updates about your groups, reviews, meetings and deadlines." actions={<Button variant="secondary" icon={CheckCheck} onClick={markAll}>Mark all as read</Button>} />
      <div className="filters">
        <Select aria-label="Filter" value={list.filters.unread || ''} onChange={(e) => list.setFilter('unread', e.target.value)}>
          <option value="">All notifications</option><option value="1">Unread only</option>
        </Select>
      </div>
      <Card>
        <DataState loading={list.loading} error={list.error} rows={list.rows} onRetry={list.reload} empty={<EmptyState icon={Bell} title="You are all caught up">New notifications will appear here instantly.</EmptyState>}>
          {list.rows?.map((n) => (
            <button key={n._id} type="button" className={`notif ${n.readAt ? '' : 'unread'}`} style={{ width: '100%', textAlign: 'left', border: 0, borderBottom: '1px solid var(--border)', background: n.readAt ? 'none' : undefined }} onClick={() => open(n)}>
              <span className={`dot ${n.readAt ? 'read' : ''}`} aria-label={n.readAt ? 'read' : 'unread'} />
              <span className="grow">
                <strong>{n.title}</strong>
                {n.body && <div className="muted small">{n.body}</div>}
                <div className="muted small">{timeAgo(n.createdAt)}</div>
              </span>
            </button>
          ))}
          <Pagination meta={list.meta} onPage={list.setPage} />
        </DataState>
      </Card>
    </>
  );
}
