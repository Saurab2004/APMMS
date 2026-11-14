import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { api, get, post, PLATFORM_SESSION_EXPIRED, PLATFORM_PASSWORD_CHANGE } from '../services/api.js';

// The platform admin's session. It is separate from AuthContext (institution users): a different cookie, different API.
const Ctx = createContext(null);
export const usePlatformAuth = () => useContext(Ctx);

export function PlatformAuthProvider({ children }) {
  const { pathname } = useLocation();
  const onPlatform = pathname.startsWith('/platform');
  const [admin, setAdmin] = useState(null);
  const [loading, setLoading] = useState(onPlatform);
  const [checked, setChecked] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);

  const refresh = useCallback(async () => {
    try { const d = await get('/platform/auth/me'); setAdmin(d.admin); return d.admin; } catch { setAdmin(null); return null; } finally { setLoading(false); setChecked(true); }
  }, []);

  // Only ask the server about an admin session when the admin console is actually being opened.
  useEffect(() => { if (onPlatform && !checked) { setLoading(true); refresh(); } }, [onPlatform, checked, refresh]);

  useEffect(() => {
    const expired = () => setAdmin((a) => { if (a) setSessionExpired(true); return null; });
    const needsPw = () => setAdmin((a) => (a ? { ...a, mustChangePassword: true } : a));
    window.addEventListener(PLATFORM_SESSION_EXPIRED, expired);
    window.addEventListener(PLATFORM_PASSWORD_CHANGE, needsPw);
    return () => { window.removeEventListener(PLATFORM_SESSION_EXPIRED, expired); window.removeEventListener(PLATFORM_PASSWORD_CHANGE, needsPw); };
  }, []);

  const login = useCallback(async (email, password) => {
    const d = await post('/platform/auth/login', { email, password });
    setSessionExpired(false); setAdmin(d.admin); setChecked(true); setLoading(false);
    return d.admin;
  }, []);
  const setup = useCallback(async (payload) => {
    const d = await post('/platform/setup', payload);
    setSessionExpired(false); setAdmin(d.admin); setChecked(true); setLoading(false);
    return d.admin;
  }, []);
  const logout = useCallback(async () => {
    try { await api.post('/platform/auth/logout'); } catch { /* already gone */ }
    setAdmin(null); setSessionExpired(false);
  }, []);

  const value = useMemo(() => ({ admin, setAdmin, loading, login, setup, logout, refresh, sessionExpired }), [admin, loading, login, setup, logout, refresh, sessionExpired]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
