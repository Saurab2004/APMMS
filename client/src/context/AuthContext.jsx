import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, get, post, SESSION_EXPIRED, PASSWORD_CHANGE } from '../services/api.js';

const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sessionExpired, setSessionExpired] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const data = await get('/auth/me');
      setUser(data.user);
      return data.user;
    } catch {
      setUser(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    const expired = () => { setUser((u) => { if (u) setSessionExpired(true); return null; }); };
    const needsPw = () => setUser((u) => (u ? { ...u, mustChangePassword: true } : u));
    window.addEventListener(SESSION_EXPIRED, expired);
    window.addEventListener(PASSWORD_CHANGE, needsPw);
    return () => { window.removeEventListener(SESSION_EXPIRED, expired); window.removeEventListener(PASSWORD_CHANGE, needsPw); };
  }, []);

  const login = useCallback(async (email, password, role) => {
    const data = await post('/auth/login', { email, password, role });
    setSessionExpired(false);
    setUser(data.user);
    return data.user;
  }, []);

  const register = useCallback(async (payload) => {
    const data = await post('/auth/register', payload);
    if (data.user) setUser(data.user); // supervisors get { pending: true } and no session
    return data;
  }, []);

  const logout = useCallback(async () => {
    try { await api.post('/auth/logout'); } catch { /* cookie may already be gone */ }
    setUser(null);
    setSessionExpired(false);
  }, []);

  const value = useMemo(() => ({ user, setUser, loading, login, register, logout, refresh, sessionExpired }), [user, loading, login, register, logout, refresh, sessionExpired]);
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}
