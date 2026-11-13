import { Download, FileText, Plus } from 'lucide-react';
import { Badge, Button, EmptyState, PageHeader, StatusBadge } from '../../components/common/ui.jsx';
import DataTable from '../../components/tables/DataTable.jsx';
import { SearchInput, Select } from '../../components/forms/fields.jsx';
import ProjectSelect from '../../components/forms/ProjectSelect.jsx';
import { usePaged } from '../../hooks/usePaged.js';
import { useAsync } from '../../hooks/useAsync.js';
import { useToast } from '../../context/ToastContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { downloadFile, errMsg, get } from '../../services/api.js';
import { fmtDate } from '../../utils/format.js';

const STATUSES = ['draft', 'submitted', 'under_review', 'revision_required', 'resubmitted', 'approved', 'rejected'];

/**
 * One list for every role. Props change what it shows:
 *  kind: 'progress' | 'final'   needsReview: start filtered to the review queue   base: link prefix
 */
export default function ReportsListPage({ title, subtitle, kind, needsReview, base, actions }) {
  const { user } = useAuth();
  const toast = useToast();
  const staff = user.role !== 'student';
  const isCoord = user.role === 'coordinator';
  const list = usePaged('/reports', { limit: 12, initialFilters: { kind: kind || '', needsReview: needsReview ? '1' : '' }, initialSort: { key: 'submittedAt', dir: 'desc' } });
  const deps = useAsync(() => (isCoord ? get('/departments') : Promise.resolve([])), []);
  const terms = useAsync(() => (isCoord ? get('/academic-terms') : Promise.resolve([])), []);
  const sups = useAsync(() => (isCoord ? get('/users/supervisors') : Promise.resolve([])), []);

  const columns = [
    { key: 'title', header: 'Report', sortKey: 'title', render: (r) => <div><strong>{r.title}</strong><div className="sub">{r.kind === 'final' ? 'Final report' : r.type} - v{r.currentVersion}{r.milestone && ` - ${r.milestone.title}`}</div></div> },
    ...(staff ? [{ key: 'group', header: 'Group', render: (r) => <div>{r.project?.group?.name}<div className="sub">{r.project?.title}</div></div> }] : []),
    ...(isCoord ? [{ key: 'supervisor', header: 'Supervisor', render: (r) => r.project?.supervisor?.name || <span className="muted">Unassigned</span> }] : []),
    { key: 'status', header: 'Status', sortKey: 'status', render: (r) => <span className="row" style={{ gap: 6 }}><StatusBadge status={r.status} />{r.isLate && <Badge tone="danger">Late</Badge>}{r.overdue && <Badge tone="danger">Overdue</Badge>}</span> },
    { key: 'deadline', header: 'Deadline', sortKey: 'deadline', render: (r) => fmtDate(r.deadline) },
    { key: 'submittedAt', header: 'Submitted', sortKey: 'submittedAt', render: (r) => fmtDate(r.submittedAt) },
    { key: 'actions', header: '', className: 'actions', render: (r) => <Button variant="secondary" size="sm" to={`${base}/${r._id}`}>{staff && ['submitted', 'resubmitted', 'under_review'].includes(r.status) && user.role === 'supervisor' ? 'Review' : 'Open'}</Button> },
  ];

  const exportCsv = () => downloadFile('/reports/export.csv', 'reports.csv').catch((e) => toast.error(errMsg(e)));

  return (
    <>
      <PageHeader title={title} subtitle={subtitle} actions={<>{actions}{isCoord && <Button variant="secondary" icon={Download} onClick={exportCsv}>Export CSV</Button>}</>} />
      <div className="filters">
        <SearchInput value={list.q} onChange={list.setQ} placeholder="Search report title" />
        {!kind && <Select aria-label="Kind" value={list.filters.kind || ''} onChange={(e) => list.setFilter('kind', e.target.value)}><option value="">Progress and final</option><option value="progress">Progress reports</option><option value="final">Final reports</option></Select>}
        <Select aria-label="Status" value={list.filters.needsReview ? 'needs' : list.filters.status || ''} onChange={(e) => { const v = e.target.value; list.setFilter('needsReview', v === 'needs' ? '1' : ''); list.setFilter('status', v === 'needs' ? '' : v); }}>
          <option value="">All statuses</option>{staff && <option value="needs">Awaiting review</option>}
          {STATUSES.filter((s) => staff ? s !== 'draft' : true).map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
        </Select>
        <Select aria-label="Timing" value={list.filters.late ? 'late' : list.filters.overdue ? 'overdue' : ''} onChange={(e) => { list.setFilter('late', e.target.value === 'late' ? '1' : ''); list.setFilter('overdue', e.target.value === 'overdue' ? '1' : ''); }}>
          <option value="">Any timing</option><option value="late">Submitted late</option><option value="overdue">Overdue (not submitted)</option>
        </Select>
        {staff && <ProjectSelect allowAll value={list.filters.project || ''} onChange={(v) => list.setFilter('project', v)} aria-label="Project" style={{ width: 'auto', minWidth: 170 }} />}
        {isCoord && <>
          <Select aria-label="Department" value={list.filters.department || ''} onChange={(e) => list.setFilter('department', e.target.value)}><option value="">All departments</option>{(deps.data || []).map((d) => <option key={d._id} value={d._id}>{d.code}</option>)}</Select>
          <Select aria-label="Semester" value={list.filters.term || ''} onChange={(e) => list.setFilter('term', e.target.value)}><option value="">All semesters</option>{(terms.data || []).map((t) => <option key={t._id} value={t._id}>{t.name}</option>)}</Select>
          <Select aria-label="Supervisor" value={list.filters.supervisor || ''} onChange={(e) => list.setFilter('supervisor', e.target.value)}><option value="">All supervisors</option>{(sups.data?.items || sups.data || []).map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}</Select>
        </>}
        {staff && <>
          <label className="small muted row" style={{ gap: 6 }}>From <input className="input" style={{ width: 'auto' }} type="date" value={list.filters.from || ''} onChange={(e) => list.setFilter('from', e.target.value)} /></label>
          <label className="small muted row" style={{ gap: 6 }}>To <input className="input" style={{ width: 'auto' }} type="date" value={list.filters.to || ''} onChange={(e) => list.setFilter('to', e.target.value)} /></label>
        </>}
      </div>
      <DataTable columns={columns} rows={list.rows} loading={list.loading} error={list.error} onRetry={list.reload} meta={list.meta} onPage={list.setPage} sort={list.sort} onSort={list.setSort} minWidth={820}
        empty={<EmptyState icon={FileText} title={needsReview ? 'No reports are waiting for your review' : 'No reports found'}>{staff ? 'Try different filters.' : 'Submitted reports and their review status appear here.'}</EmptyState>} />
    </>
  );
}
