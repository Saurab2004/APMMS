import BrandMark from '../../components/common/BrandMark.jsx';
import { GraduationCap, ShieldCheck, FileCheck2, MessagesSquare, Activity } from 'lucide-react';

export default function AuthShell({ children }) {
  return (
    <div className="auth">
      <aside className="auth-aside">
        <div className="row" style={{ gap: 10 }}>
          <BrandMark size={20} style={{ background: 'rgba(255,255,255,.18)' }} />
          <strong style={{ fontSize: '1.125rem' }}>APMMS</strong>
        </div>
        <div>
          <h2>Academic Project Management and Monitoring System</h2>
          <p>One place for groups, proposals, progress reports, feedback, chat and final evaluation.</p>
          <ul>
            <li><FileCheck2 size={18} />Structured proposal and report review with full version history</li>
            <li><Activity size={18} />Milestones, deadlines and supervisor monitoring</li>
            <li><MessagesSquare size={18} />Real-time team and supervisor chat</li>
            <li><ShieldCheck size={18} />Role-based access and a complete audit trail</li>
          </ul>
        </div>
        <small style={{ color: '#bfdbfe' }}>University project</small>
      </aside>
      <main className="auth-main"><div className="auth-card">{children}</div></main>
    </div>
  );
}
