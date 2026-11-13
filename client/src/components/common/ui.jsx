import { Link } from 'react-router-dom';
import { Inbox, AlertTriangle, Info, CheckCircle2, ChevronRight } from 'lucide-react';
import { cx, titleCase, initials } from '../../utils/format.js';

export function Button({ variant = 'primary', size, icon: Icon, loading, block, className, children, to, ...rest }) {
  const cls = cx('btn', `btn-${variant}`, size === 'sm' && 'btn-sm', block && 'btn-block', className);
  const content = (
    <>
      {loading ? <span className="spinner" aria-hidden="true" /> : Icon ? <Icon size={size === 'sm' ? 15 : 17} aria-hidden="true" /> : null}
      {children}
    </>
  );
  if (to) return <Link to={to} className={cls} {...rest}>{content}</Link>;
  return (
    <button type="button" className={cls} disabled={loading || rest.disabled} {...rest}>
      {content}
    </button>
  );
}

export function IconButton({ icon: Icon, label, variant = 'ghost', ...rest }) {
  return (
    <button type="button" className={cx('btn', `btn-${variant}`, 'btn-icon')} aria-label={label} title={label} {...rest}>
      <Icon size={19} aria-hidden="true" />
    </button>
  );
}

export const Card = ({ className, children, ...rest }) => <section className={cx('card', className)} {...rest}>{children}</section>;
export const CardBody = ({ className, children }) => <div className={cx('card-body', className)}>{children}</div>;
export const CardHead = ({ title, children, icon: Icon }) => (
  <div className="card-head">
    <h2 className="row" style={{ gap: 8, fontSize: 'var(--fs-card)' }}>{Icon && <Icon size={18} aria-hidden="true" />}{title}</h2>
    {children && <div className="row">{children}</div>}
  </div>
);

export function StatCard({ label, value, hint, icon: Icon, tone, to }) {
  const inner = (
    <>
      <div className="stat-label">{Icon && <Icon size={15} aria-hidden="true" />}{label}</div>
      <div className="stat-value">{value ?? '-'}</div>
      {hint && <div className="stat-hint">{hint}</div>}
    </>
  );
  const cls = cx('stat', tone && `tone-${tone}`);
  return to ? <Link to={to} className={cls}>{inner}</Link> : <div className={cls}>{inner}</div>;
}

export function Alert({ tone = 'info', children, className }) {
  const Icon = { info: Info, success: CheckCircle2, warning: AlertTriangle, danger: AlertTriangle }[tone];
  return (
    <div className={cx('alert', `alert-${tone}`, className)} role={tone === 'danger' ? 'alert' : undefined}>
      <Icon size={18} aria-hidden="true" />
      <div className="grow">{children}</div>
    </div>
  );
}

/** One place that decides the colour of every status in the app (same meaning for every role). */
const STATUS = {
  // proposals / reports
  draft: ['neutral', 'Draft'], submitted: ['info', 'Submitted'], under_review: ['warning', 'Under review'],
  revision_required: ['warning', 'Revision required'], resubmitted: ['info', 'Resubmitted'], approved: ['success', 'Approved'],
  rejected: ['danger', 'Rejected'], late: ['danger', 'Late'], overdue: ['danger', 'Overdue'],
  // projects
  forming: ['neutral', 'Forming'], proposal: ['indigo', 'Proposal'], active: ['info', 'Active'], final_review: ['warning', 'Final review'],
  ready_for_evaluation: ['indigo', 'Ready for evaluation'], evaluated: ['success', 'Evaluated'], completed: ['success', 'Completed'], archived: ['neutral', 'Archived'],
  // milestones, logs, meetings, groups
  pending: ['warning', 'Pending'], in_progress: ['info', 'In progress'], skipped: ['neutral', 'Skipped'],
  open: ['warning', 'Open'], responded: ['info', 'Responded'], closed: ['neutral', 'Closed'],
  scheduled: ['info', 'Scheduled'], cancelled: ['neutral', 'Cancelled'], dissolved: ['danger', 'Dissolved'],
  accepted: ['success', 'Accepted'], expired: ['danger', 'Expired'], revoked: ['danger', 'Revoked'], left: ['neutral', 'Left'], removed: ['danger', 'Removed'],
  inactive: ['neutral', 'Inactive'], published: ['success', 'Published'], unpublished: ['neutral', 'Not published'],
  leader: ['indigo', 'Leader'], member: ['neutral', 'Member'],
  student: ['info', 'Student'], supervisor: ['indigo', 'Supervisor'], coordinator: ['success', 'Coordinator'], evaluator: ['warning', 'Evaluator'],
};
export function StatusBadge({ status, label }) {
  const [tone, text] = STATUS[status] || ['neutral', titleCase(status || '-')];
  return <span className={cx('badge', `badge-${tone}`)}>{label || text}</span>;
}
export const Badge = ({ tone = 'neutral', children }) => <span className={cx('badge', `badge-${tone}`)}>{children}</span>;

export const Spinner = () => <span className="spinner" role="status" aria-label="Loading" />;
export const Loading = ({ text = 'Loading...' }) => <div className="loading"><Spinner />{text}</div>;

export function EmptyState({ icon: Icon = Inbox, title = 'Nothing here yet', children, action }) {
  return (
    <div className="empty">
      <Icon size={40} aria-hidden="true" />
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ message, onRetry }) {
  return (
    <div className="empty">
      <AlertTriangle size={40} style={{ color: 'var(--danger)' }} aria-hidden="true" />
      <h3>Something went wrong</h3>
      <p>{message}</p>
      {onRetry && <Button variant="secondary" onClick={onRetry}>Try again</Button>}
    </div>
  );
}

/** Shows loading / error while data is not ready, then renders children(data). */
export function Async({ state, children, empty }) {
  if (state.loading && !state.data) return <Loading />;
  if (state.error && !state.data) return <ErrorState message={state.error} onRetry={state.reload} />;
  if (state.data == null) return null;
  if (empty && Array.isArray(state.data) && !state.data.length) return empty;
  return children(state.data);
}

export const ProgressBar = ({ value = 0, tone }) => (
  <div className={cx('progress', tone)} role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
    <span style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
  </div>
);

export const Avatar = ({ name }) => <span className="avatar" aria-hidden="true">{initials(name)}</span>;

/** Horizontal bar chart built from real numbers - no chart library needed. */
export function BarList({ rows, tone }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (!rows.length) return <p className="muted small">No data yet.</p>;
  return (
    <div className="bars">
      {rows.map((r) => (
        <div className="bar-row" key={r.label}>
          <span className="label-text" title={r.label}>{r.label}</span>
          <div className="bar-track"><div className={cx('bar-fill', tone)} style={{ width: `${(r.value / max) * 100}%` }} /></div>
          <span className="num">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

export function KV({ items }) {
  return (
    <dl className="kv">
      {items.filter(Boolean).map(([k, v]) => (
        <div key={k} style={{ display: 'contents' }}><dt>{k}</dt><dd>{v ?? '-'}</dd></div>
      ))}
    </dl>
  );
}

export function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="page-header">
      <div style={{ minWidth: 0 }}>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

export function Breadcrumbs({ items }) {
  return (
    <nav className="breadcrumbs" aria-label="Breadcrumb">
      {items.map((c, i) => {
        const last = i === items.length - 1;
        return (
          <span key={c.to || c.label} className={cx('row', !last && i > 0 && 'crumb-mid')} style={{ gap: 6, flexWrap: 'nowrap', minWidth: 0 }}>
            {i > 0 && <ChevronRight size={14} aria-hidden="true" />}
            {last || !c.to ? <span className="current" aria-current={last ? 'page' : undefined}>{c.label}</span> : <Link to={c.to}>{c.label}</Link>}
          </span>
        );
      })}
    </nav>
  );
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.key} role="tab" type="button" className="tab" aria-selected={value === t.key} onClick={() => onChange(t.key)}>
          {t.label}{t.count !== undefined && <span className="count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}
