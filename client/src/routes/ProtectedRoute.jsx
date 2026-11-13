import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { Loading } from '../components/common/ui.jsx';
import { homeFor } from '../utils/format.js';

/** Redirects to login if signed out, forces a password change when required, and checks the role. */
export default function ProtectedRoute({ roles }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center' }}><Loading text="Loading your workspace..." /></div>;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  if (user.mustChangePassword && location.pathname !== '/change-password') return <Navigate to="/change-password" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/access-denied" replace state={{ home: homeFor(user.role) }} />;
  return <Outlet />;
}
