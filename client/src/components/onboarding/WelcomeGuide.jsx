import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, CheckCircle2 } from 'lucide-react';
import { Modal } from '../common/Modal.jsx';
import { Button } from '../common/ui.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { post } from '../../services/api.js';
import { WELCOME } from './guideContent.js';

export const OPEN_GUIDE = 'apmms:open-guide';
export const openGuide = () => window.dispatchEvent(new Event(OPEN_GUIDE));

/** Short welcome shown once after the first login. Skippable; can be reopened from Help. */
export default function WelcomeGuide() {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const w = WELCOME[user?.role];

  useEffect(() => { if (user && !user.mustChangePassword && !user.onboardingSeenAt) setOpen(true); }, [user]);
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(OPEN_GUIDE, show);
    return () => window.removeEventListener(OPEN_GUIDE, show);
  }, []);

  if (!open || !w) return null;
  const close = async (to) => {
    setOpen(false);
    if (!user.onboardingSeenAt) {
      try { const r = await post('/auth/onboarding-seen'); setUser((u) => (u ? { ...u, onboardingSeenAt: r.onboardingSeenAt } : u)); } catch { /* it just shows once more next time */ }
    }
    if (to) navigate(to);
  };
  return (
    <Modal title={w.title} onClose={() => close()}
      footer={<><Button variant="ghost" onClick={() => close()}>Skip for now</Button><Button icon={ArrowRight} onClick={() => close(w.next.to)}>{w.next.label}</Button></>}>
      <div className="stack">
        <p style={{ margin: 0 }}><strong>Hello {user.name}.</strong> {w.purpose}</p>
        <ul className="guide-list">{w.actions.map((a) => <li key={a}><CheckCircle2 size={16} aria-hidden="true" /> <span>{a}</span></li>)}</ul>
        <p className="muted small" style={{ margin: 0 }}>You can open this again any time from <strong>Help</strong> in the menu.</p>
      </div>
    </Modal>
  );
}
