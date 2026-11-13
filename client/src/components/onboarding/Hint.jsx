import { useState } from 'react';
import { Lightbulb, X } from 'lucide-react';
import { HINTS } from './guideContent.js';

const key = (id) => `apmms.hint.${id}`;
const read = (id) => { try { return localStorage.getItem(key(id)) === 'off'; } catch { return false; } };
const write = (id, off) => { try { localStorage.setItem(key(id), off ? 'off' : 'on'); } catch { /* ignore: hint simply shows again */ } };

/** A short, dismissible tip box. `id` selects the text from guideContent.js. */
export default function Hint({ id, className = 'mb' }) {
  const h = HINTS[id];
  const [hidden, setHidden] = useState(() => read(id));
  if (!h) return null;
  if (hidden) {
    return <div className={className}><button type="button" className="link-btn small" onClick={() => { write(id, false); setHidden(false); }}><Lightbulb size={14} aria-hidden="true" /> Show tips</button></div>;
  }
  return (
    <aside className={`hint ${className}`} aria-label={h.title}>
      <Lightbulb size={18} aria-hidden="true" className="hint-icon" />
      <div className="grow">
        <strong>{h.title}</strong>
        <ul>{h.items.map((t) => <li key={t}>{t}</li>)}</ul>
      </div>
      <button type="button" className="btn btn-ghost btn-icon" title="Hide these tips" aria-label="Hide these tips" onClick={() => { write(id, true); setHidden(true); }}><X size={16} /></button>
    </aside>
  );
}
