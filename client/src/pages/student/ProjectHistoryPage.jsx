import { Award, Download } from 'lucide-react';
import { Alert, Badge, Button, Card, CardBody, CardHead, EmptyState, ErrorState, Loading, PageHeader, StatusBadge } from '../../components/common/ui.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { useMyProject } from '../../hooks/useProjects.js';
import { downloadFile, errMsg, get } from '../../services/api.js';
import { useToast } from '../../context/ToastContext.jsx';
import { fmtDateTime } from '../../utils/format.js';

export default function ProjectHistoryPage() {
  const mine = useMyProject();
  const toast = useToast();
  const id = mine.data?.projectId;
  const tl = useAsync(() => (id ? get(`/projects/${id}/timeline`, { limit: 100 }) : Promise.resolve([])), [id]);
  const res = useAsync(() => get('/evaluations/my-results'), []);
  if (mine.loading || tl.loading) return <Loading />;
  if (tl.error) return <ErrorState message={tl.error} onRetry={tl.reload} />;
  if (!id) return <Card><EmptyState title="No project yet" /></Card>;
  const r = res.data;
  return (
    <>
      <PageHeader title="Project history" subtitle="Everything that happened in your project, and published evaluation results." />
      <div className="grid cols-2" style={{ alignItems: 'start' }}>
        <Card><CardHead title="Activity timeline" /><CardBody>{!tl.data.length ? <EmptyState title="No activity yet" /> : (
          <ul className="timeline">{tl.data.map((a) => <li key={a._id}><strong>{a.summary || a.action}</strong><div className="muted small">{a.actor?.name} - {fmtDateTime(a.createdAt)}</div></li>)}</ul>)}</CardBody></Card>
        <Card><CardHead title="Evaluation results" icon={Award} /><CardBody className="stack">
          {r?.published && <div><Button variant="secondary" icon={Download} onClick={() => downloadFile(`/evaluations/results/${id}/report.pdf`, 'evaluation-report.pdf').catch((e) => toast.error(errMsg(e)))}>Download evaluation report (PDF)</Button></div>}
          {!r?.published ? <Alert tone="info">Results are not published yet. The coordinator releases them after all evaluations are complete.</Alert> :
            r.results.map((x) => (
              <div key={x.rubric._id} className="stack-sm"><h3>{x.rubric.name}</h3>
                {x.evaluations.map((e) => <div key={e._id} className="card" style={{ padding: 12 }}><div className="row between"><strong>{e.evaluatorName}</strong><span><Badge tone="indigo">{e.grade || '-'}</Badge> <strong>{e.total}/{e.maxTotal}</strong> ({e.percentage}%)</span></div>
                  {e.remarks && <div className="small pre-wrap mt">{e.remarks}</div>}</div>)}</div>))}
        </CardBody></Card>
      </div>
    </>
  );
}
