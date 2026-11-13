import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { IconButton } from '../common/ui.jsx';
import { Input } from './fields.jsx';

export function passwordScore(p = '') {
  let n = 0;
  if (p.length >= 8) n++;
  if (/[A-Za-z]/.test(p) && /\d/.test(p)) n++;
  if (p.length >= 12 || (/[^A-Za-z0-9]/.test(p) && p.length >= 8)) n++;
  return n;
}

/** Password box with a show/hide button and an optional strength bar. */
export default function PasswordInput({ showStrength, value, ...rest }) {
  const [show, setShow] = useState(false);
  const score = passwordScore(value);
  return (
    <>
      <div className="pw-wrap">
        <Input type={show ? 'text' : 'password'} value={value} {...rest} />
        <span className="pw-toggle"><IconButton icon={show ? EyeOff : Eye} label={show ? 'Hide password' : 'Show password'} onClick={() => setShow((s) => !s)} /></span>
      </div>
      {showStrength && value ? (
        <>
          <div className="strength" aria-hidden="true">{[1, 2, 3].map((i) => <span key={i} className={score >= i ? `on-${score}` : ''} />)}</div>
          <div className="muted small">{['Too weak', 'Weak - add a number and 8+ characters', 'Good', 'Strong'][score]}</div>
        </>
      ) : null}
    </>
  );
}
