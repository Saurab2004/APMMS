import { Link, useLocation } from 'react-router-dom';
import { ShieldAlert, Compass } from 'lucide-react';
import { Button, EmptyState } from '../../components/common/ui.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { homeFor } from '../../utils/format.js';

export function AccessDenied() {
  const { user } = useAuth();
  const { state } = useLocation();
  return (
    <div style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 16 }}>
      <EmptyState icon={ShieldAlert} title="Access denied" action={<Button to={state?.home || (user ? homeFor(user.role) : '/login')}>Go to my workspace</Button>}>
        Your account does not have permission to open this page.
      </EmptyState>
    </div>
  );
}

export function NotFound() {
  const { user } = useAuth();
  return (
    <div style={{ minHeight: '60dvh', display: 'grid', placeItems: 'center', padding: 16 }}>
      <EmptyState icon={Compass} title="Page not found" action={<Link className="btn btn-primary" to={user ? homeFor(user.role) : '/login'}>Back to start</Link>}>
        The page you are looking for does not exist or was moved.
      </EmptyState>
    </div>
  );
}
