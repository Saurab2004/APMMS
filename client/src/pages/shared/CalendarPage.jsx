import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Flag, CalendarDays, FileText, Clock } from 'lucide-react';
import { Badge, Button, Card, CardBody, ErrorState, Loading, PageHeader } from '../../components/common/ui.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { get } from '../../services/api.js';
import { cx, fmtTime, titleCase } from '../../utils/format.js';

const TYPE = {
  milestone: { label: 'Milestone', icon: Flag, tone: 'info' },
  meeting: { label: 'Meeting', icon: CalendarDays, tone: 'indigo' },
  report: { label: 'Report due', icon: FileText, tone: 'warning' },
  deadline: { label: 'Deadline', icon: Clock, tone: 'danger' },
};
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const key = (d) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

function linkFor(role, e) {
  const base = `/${role}`;
  if (e.type === 'meeting') return `${base}/meetings`;
  if (e.type === 'milestone') return role === 'student' ? `${base}/project` : role === 'supervisor' ? `${base}/milestones` : e.projectId ? `${base}/projects/${e.projectId}` : base;
  if (e.type === 'report') return role === 'student' ? `${base}/reports` : `${base}/reports`;
  return null;
}

/** Month calendar of milestones, meetings and deadlines. Same page for every role; the server only returns what you may see. */
export default function CalendarPage() {
  const { user } = useAuth();
  const [cursor, setCursor] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [selected, setSelected] = useState(() => key(new Date()));
  const first = cursor;
  const start = new Date(first.getFullYear(), first.getMonth(), 1 - ((first.getDay() + 6) % 7)); // grid starts on Monday
  const cells = useMemo(() => Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)), [cursor]); // eslint-disable-line
  const state = useAsync(() => get('/calendar', { from: cells[0].toISOString(), to: new Date(cells[41].getFullYear(), cells[41].getMonth(), cells[41].getDate() + 1).toISOString() }), [cursor.getTime()]);
  const byDay = useMemo(() => { const m = {}; for (const e of state.data || []) (m[key(new Date(e.date))] ||= []).push(e); return m; }, [state.data]);
  const today = key(new Date());
  const picked = byDay[selected] || [];
  const move = (n) => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + n, 1));
  const upcoming = (state.data || []).filter((e) => new Date(e.date) >= new Date(new Date().setHours(0, 0, 0, 0)));

  return (
    <>
      <PageHeader title="Calendar" subtitle="Milestones, meetings and deadlines in one place." actions={<>
        <Button variant="secondary" icon={ChevronLeft} aria-label="Previous month" onClick={() => move(-1)} />
        <Button variant="secondary" onClick={() => { const d = new Date(); setCursor(new Date(d.getFullYear(), d.getMonth(), 1)); setSelected(key(d)); }}>Today</Button>
        <Button variant="secondary" icon={ChevronRight} aria-label="Next month" onClick={() => move(1)} /></>} />
      <div className="row mb">{Object.entries(TYPE).map(([k, t]) => <Badge key={k} tone={t.tone}>{t.label}</Badge>)}</div>
      {state.error && !state.data ? <ErrorState message={state.error} onRetry={state.reload} /> : (
        <div className="grid" style={{ gridTemplateColumns: 'minmax(0,3fr) minmax(0,1fr)', alignItems: 'start' }} id="cal-grid">
          <Card>
            <CardBody>
              <h2 style={{ marginTop: 0 }}>{cursor.toLocaleString('en', { month: 'long', year: 'numeric' })} {state.loading && <span className="muted small">updating...</span>}</h2>
              <div className="cal" role="grid" aria-label="Month calendar">
                {DAYS.map((d) => <div key={d} className="cal-head" role="columnheader">{d}</div>)}
                {cells.map((d) => {
                  const k = key(d); const ev = byDay[k] || [];
                  return (
                    <button type="button" key={k + d.getTime()} className={cx('cal-cell', d.getMonth() !== cursor.getMonth() && 'other', k === today && 'today', k === selected && 'selected')} onClick={() => setSelected(k)} aria-label={`${d.toDateString()}, ${ev.length} item${ev.length === 1 ? '' : 's'}`}>
                      <span className="cal-num">{d.getDate()}</span>
                      <span className="cal-dots">{ev.slice(0, 3).map((e) => <i key={e.id} className={`dot dot-${e.type}`} />)}{ev.length > 3 && <small>+{ev.length - 3}</small>}</span>
                    </button>);
                })}
              </div>
            </CardBody>
          </Card>
          <div className="stack">
            <Card><CardBody>
              <h3 style={{ marginTop: 0 }}>{new Date(selected.split('-')[0], selected.split('-')[1] - 1, selected.split('-')[2]).toDateString()}</h3>
              {state.loading && !state.data ? <Loading /> : !picked.length ? <p className="muted small" style={{ margin: 0 }}>Nothing planned on this day.</p> : (
                <ul className="list">{picked.map((e) => <EventRow key={e.id} e={e} role={user.role} />)}</ul>)}
            </CardBody></Card>
            <Card><CardBody>
              <h3 style={{ marginTop: 0 }}>Coming up this month</h3>
              {!upcoming.length ? <p className="muted small" style={{ margin: 0 }}>No upcoming items in this view.</p> : <ul className="list">{upcoming.slice(0, 6).map((e) => <EventRow key={e.id} e={e} role={user.role} showDate />)}</ul>}
            </CardBody></Card>
          </div>
        </div>)}
      <style>{`@media (max-width: 960px) { #cal-grid { grid-template-columns: minmax(0,1fr) !important; } }`}</style>
    </>
  );
}

function EventRow({ e, role, showDate }) {
  const t = TYPE[e.type]; const Icon = t.icon; const to = linkFor(role, e);
  const title = <strong>{e.title}</strong>;
  return (
    <li>
      <div className="row" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
        <Icon size={16} style={{ marginTop: 3, flex: 'none' }} aria-hidden="true" />
        <div style={{ minWidth: 0 }}>
          {to ? <Link to={to}>{title}</Link> : title}
          <div className="muted small">{showDate ? `${new Date(e.date).toLocaleDateString('en', { day: 'numeric', month: 'short' })} - ` : ''}{e.type === 'meeting' ? `${fmtTime(e.date)} - ` : ''}{t.label}{e.group ? ` - ${e.group}` : ''}{e.status && e.status !== 'pending' ? ` - ${titleCase(e.status)}` : ''}{e.place ? ` - ${e.place}` : ''}</div>
        </div>
      </div>
    </li>
  );
}
