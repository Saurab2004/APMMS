import { Download } from 'lucide-react';
import { useState } from 'react';
import { BarList, Button, Card, CardBody, CardHead, ErrorState, Loading, PageHeader, StatCard } from '../../components/common/ui.jsx';
import { Field, Select } from '../../components/forms/fields.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { useToast } from '../../context/ToastContext.jsx';
import { downloadFile, errMsg, get } from '../../services/api.js';
import { PROJECT_STATUSES } from '../../utils/constants.js';
import { pct, titleCase } from '../../utils/format.js';

export default function AnalyticsPage() {
  const toast = useToast();
  const [filters, setFilters] = useState({ department: '', term: '', supervisor: '', status: '' });
  const clean = Object.fromEntries(Object.entries(filters).filter(([, v]) => v));
  const lk = useAsync(() => Promise.all([get('/departments'), get('/academic-terms'), get('/users', { role: 'supervisor', limit: 100 })]), []);
  const state = useAsync(() => get('/analytics', clean), [JSON.stringify(clean)]);
  const [deps, terms, sups] = lk.data || [[], [], []];
  const set = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.value }));
  const exportCsv = async (url, name) => { try { await downloadFile(`${url}?${new URLSearchParams(clean)}`, name); } catch (e) { toast.error(errMsg(e)); } };
  const d = state.data;
  return (
    <>
      <PageHeader title="Analytics" subtitle="Computed live from project, report, milestone and evaluation records." actions={<>
        <Button variant="secondary" icon={Download} onClick={() => exportCsv('/analytics/export/analytics.pdf', 'analytics.pdf')}>PDF summary</Button>
        <Button variant="secondary" icon={Download} onClick={() => exportCsv('/analytics/export/projects.csv', 'projects.csv')}>Projects CSV</Button>
        <Button variant="secondary" icon={Download} onClick={() => exportCsv('/reports/export.csv', 'reports.csv')}>Reports CSV</Button></>} />
      <Card className="mb"><CardBody className="form-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
        <Field label="Department"><Select value={filters.department} onChange={set('department')}><option value="">All</option>{deps.map((x) => <option key={x._id} value={x._id}>{x.name}</option>)}</Select></Field>
        <Field label="Term"><Select value={filters.term} onChange={set('term')}><option value="">All</option>{terms.map((x) => <option key={x._id} value={x._id}>{x.name}</option>)}</Select></Field>
        <Field label="Supervisor"><Select value={filters.supervisor} onChange={set('supervisor')}><option value="">All</option>{sups.map((x) => <option key={x._id} value={x._id}>{x.name}</option>)}</Select></Field>
        <Field label="Stage"><Select value={filters.status} onChange={set('status')}><option value="">All</option>{PROJECT_STATUSES.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}</Select></Field>
      </CardBody></Card>
      {state.loading && !d ? <Loading /> : state.error && !d ? <ErrorState message={state.error} onRetry={state.reload} /> : (
        <>
          <div className="grid mb" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
            <StatCard label="Proposal approval rate" value={pct(d.proposals.approvalRate)} hint="approved / decided" />
            <StatCard label="Reports submitted" value={d.reports.submitted} hint={`${d.reports.late} late`} />
            <StatCard label="Awaiting review" value={d.reports.awaitingReview} tone={d.reports.awaitingReview ? 'warning' : undefined} />
            <StatCard label="Milestones done" value={`${d.milestones.completed}/${d.milestones.total}`} hint={`${d.milestones.overdue} overdue`} tone={d.milestones.overdue ? 'danger' : undefined} />
            <StatCard label="Evaluations submitted" value={pct(d.evaluation.completion)} hint={`${d.evaluation.submitted} of ${d.evaluation.total}`} />
          </div>
          <div className="grid cols-2" style={{ alignItems: 'start' }}>
            <Card><CardHead title="Projects by stage" /><CardBody><BarList rows={d.stages.map((s) => ({ label: titleCase(s.status), value: s.count }))} /></CardBody></Card>
            <Card><CardHead title="Proposals by status" /><CardBody><BarList tone="indigo" rows={d.proposals.byStatus.map((s) => ({ label: titleCase(s.status), value: s.count }))} /></CardBody></Card>
            <Card><CardHead title="Reports by status" /><CardBody><BarList rows={d.reports.byStatus.map((s) => ({ label: titleCase(s.status), value: s.count }))} /></CardBody></Card>
            <Card><CardHead title="Department comparison" /><CardBody><BarList tone="indigo" rows={d.departments.map((x) => ({ label: x.department, value: x.projects }))} /></CardBody></Card>
            <Card><CardHead title="Supervisor workload" /><CardBody><BarList rows={d.supervisorWorkload.map((x) => ({ label: x.name, value: x.projects }))} /></CardBody></Card>
          </div>
        </>)}
    </>
  );
}
