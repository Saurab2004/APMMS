import { Link } from 'react-router-dom';
import { ArrowRight, CheckCircle2, Circle } from 'lucide-react';
import { Card, CardBody, CardHead } from './ui.jsx';
import { cx } from '../../utils/format.js';

/**
 * A short checklist: finished steps are ticked, the first open step is highlighted as "Next".
 * steps: [{ text, hint?, done?, to? }]
 */
export default function NextSteps({ title = 'What to do next', steps, emptyText }) {
  const firstOpen = steps.findIndex((s) => !s.done);
  const allDone = steps.length > 0 && firstOpen === -1;
  return (
    <Card className="mb">
      <CardHead title={title} />
      <CardBody>
        {!steps.length ? <p className="muted" style={{ margin: 0 }}>{emptyText || 'You are all caught up.'}</p> : (
          <ol className="steps">
            {steps.map((s, i) => (
              <li key={s.text} className={cx(s.done && 'done', i === firstOpen && 'next')}>
                {s.done ? <CheckCircle2 size={20} aria-label="Done" style={{ color: 'var(--success)' }} /> : <Circle size={20} aria-label="To do" />}
                <div className="grow">
                  <strong>{s.text}</strong>
                  {i === firstOpen && <span className="next-tag">Next</span>}
                  {s.hint && <div className="muted small">{s.hint}</div>}
                </div>
                {s.to && !s.done && <Link to={s.to} className="small row" style={{ gap: 4, flexWrap: 'nowrap' }}>Open <ArrowRight size={14} aria-hidden="true" /></Link>}
              </li>))}
          </ol>)}
        {allDone && <p className="muted small" style={{ margin: '12px 0 0' }}>Everything on this list is done.</p>}
      </CardBody>
    </Card>
  );
}
