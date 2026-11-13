import { Award, Clock } from 'lucide-react';
import { Alert, Badge, Button, Card, CardBody, EmptyState, ErrorState, Loading, PageHeader, StatusBadge } from '../../components/common/ui.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { get } from '../../services/api.js';
import { fmtDateTime } from '../../utils/format.js';

export function EvaluatorHome() {
  const { user } = useAuth();
  const state = useAsync(() => get('/evaluations/mine'), []);
  if (state.loading && !state.data) return <Loading />;
  if (state.error && !state.data) return <ErrorState message={state.error} onRetry={state.reload} />;
  return (
    <>
      <PageHeader title="My evaluation assignments" subtitle="You can only see the projects the coordinator assigned to you." />
      {user.accessExpiresAt && <Alert tone="warning" className="mb">Your access expires on <strong>{fmtDateTime(user.accessExpiresAt)}</strong>. Submitted evaluations are kept afterwards.</Alert>}
      {!state.data.length ? <Card><EmptyState icon={Award} title="No assignments right now">Your access may have expired or been revoked, or the final reports are not approved yet.</EmptyState></Card> : (
        <div className="stack">{state.data.map((a) => (
          <Card key={`${a.project._id}-${a.rubric._id}`}><CardBody className="row between">
            <div><h3>{a.project.group?.name}</h3><div className="muted small">{a.project.title}</div><div className="muted small">Rubric: {a.rubric?.name}{!a.finalReport && ' - final report not available yet'}</div></div>
            <div className="row">{a.evaluation ? <StatusBadge status={a.evaluation.status === 'submitted' ? 'completed' : 'draft'} label={a.evaluation.status === 'submitted' ? 'Submitted' : 'Draft'} /> : <Badge>Not started</Badge>}
              <Button to={`/evaluator/evaluate/${a.project._id}/${a.rubric._id}`} variant={a.evaluation?.status === 'submitted' ? 'secondary' : 'primary'}>{a.evaluation?.status === 'submitted' ? 'View' : 'Evaluate'}</Button></div>
          </CardBody></Card>))}</div>)}
    </>
  );
}
