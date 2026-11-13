import { useEffect, useState } from 'react';
import { ScanSearch } from 'lucide-react';
import { Alert, Badge, Button, Loading } from '../common/ui.jsx';
import { errMsg, get } from '../../services/api.js';

const TONE = { high: 'danger', medium: 'warning', low: 'info' };
const TEXT = { high: 'Very similar', medium: 'Somewhat similar', low: 'Slightly similar' };

/**
 * Warns when another project in the system is about the same idea.
 * auto: check immediately (reviewers, submit dialog). Otherwise the student presses the button.
 */
export default function SimilarProjects({ projectId, auto = false }) {
  const [state, setState] = useState({ loading: false, data: null, error: '' });
  const run = async () => {
    setState({ loading: true, data: null, error: '' });
    try { setState({ loading: false, data: await get(`/proposals/project/${projectId}/similar`), error: '' }); }
    catch (e) { setState({ loading: false, data: null, error: errMsg(e) }); }
  };
  useEffect(() => { if (auto && projectId) run(); }, [projectId, auto]); // eslint-disable-line

  const { loading, data, error } = state;
  return (
    <div className="stack-sm">
      {!auto && !data && <div><Button variant="secondary" size="sm" icon={ScanSearch} loading={loading} onClick={run}>Check for similar projects</Button></div>}
      {auto && loading && <Loading text="Checking for similar projects..." />}
      {error && <Alert tone="danger">{error}</Alert>}
      {data && !data.checked && <Alert>Save your proposal title and abstract first, then run the check.</Alert>}
      {data?.checked && !data.matches.length && <Alert tone="success">No similar projects found. Your idea looks original compared with the other projects in this system.</Alert>}
      {data?.matches?.length > 0 && (
        <>
          <Alert tone={data.matches[0].level === 'high' ? 'danger' : 'warning'}>
            {data.matches[0].level === 'high' ? 'This proposal is very close to an existing project. Please make your idea clearly different, or explain the difference to your supervisor.' : 'Some existing projects overlap with this one. This is only a warning.'}
          </Alert>
          <ul className="list">{data.matches.map((m, i) => (
            <li key={i} className="row between">
              <span><strong>{m.title}</strong><div className="muted small">{[m.group, m.term].filter(Boolean).join(' - ') || 'Earlier project'}</div></span>
              <span className="row"><Badge tone={TONE[m.level]}>{m.score}% - {TEXT[m.level]}</Badge></span>
            </li>))}</ul>
        </>
      )}
      <p className="muted small" style={{ margin: 0 }}>This compares words and phrases with other proposals in APMMS. It does not search the internet and is not proof of plagiarism.</p>
    </div>
  );
}
