import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CheckCircle2, Clock, Info, XCircle } from 'lucide-react';
import AuthShell from './AuthShell.jsx';
import { Button, Loading } from '../../components/common/ui.jsx';
import ResendVerification from '../../components/forms/ResendVerification.jsx';
import { errMsg, post } from '../../services/api.js';

/** The page the email link opens: /verify-email?token=... */
export default function VerifyEmail() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const [state, setState] = useState({ status: token ? 'loading' : 'invalid', message: 'This link has no verification code. Open the link from your email again.' });
  const started = useRef(false); // React dev mode runs effects twice; the link may only be used once

  useEffect(() => {
    if (!token || started.current) return;
    started.current = true;
    post('/auth/verify-email', { token })
      .then((d) => setState({ status: 'ok', pending: d.pendingApproval }))
      .catch((e) => setState({
        status: e.code === 'TOKEN_EXPIRED' ? 'expired' : e.code === 'TOKEN_USED' ? 'used' : 'invalid',
        message: errMsg(e),
        pending: e.details?.pendingApproval,
      }));
  }, [token]);

  const s = state;
  return (
    <AuthShell>
      <div className="center stack">
        {s.status === 'loading' && <Loading text="Verifying your email..." />}
        {s.status === 'ok' && (<>
          <CheckCircle2 size={44} style={{ color: 'var(--success)', margin: '0 auto' }} />
          <h1>Email verified</h1>
          <p className="muted">{s.pending ? 'Thank you! Your supervisor account now waits for the coordinator to approve it. You can log in once it is approved.' : 'Thank you! Your account is ready. You can log in now.'}</p>
          <Button to="/login">Go to login</Button>
        </>)}
        {s.status === 'used' && (<>
          <Info size={44} style={{ color: 'var(--primary)', margin: '0 auto' }} />
          <h1>Link already used</h1>
          <p className="muted">{s.message}</p>
          <Button to="/login">Go to login</Button>
        </>)}
        {s.status === 'expired' && (<>
          <Clock size={44} style={{ color: 'var(--warning)', margin: '0 auto' }} />
          <h1>Link expired</h1>
          <p className="muted">{s.message}</p>
          <ResendVerification />
        </>)}
        {s.status === 'invalid' && (<>
          <XCircle size={44} style={{ color: 'var(--danger)', margin: '0 auto' }} />
          <h1>Link not valid</h1>
          <p className="muted">{s.message}</p>
          <ResendVerification />
          <Button variant="ghost" to="/login">Back to login</Button>
        </>)}
      </div>
    </AuthShell>
  );
}
