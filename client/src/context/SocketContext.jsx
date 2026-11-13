import { createContext, useContext, useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { io } from 'socket.io-client';
import { useAuth } from './AuthContext.jsx';
import { useToast } from './ToastContext.jsx';
import { get } from '../services/api.js';

const SocketCtx = createContext({ socket: null, connected: false, unread: 0, refreshUnread: () => {}, setUnread: () => {} });
export const useSocket = () => useContext(SocketCtx);

/** One authenticated Socket.IO connection for the whole app (live notifications + chat). */
export function SocketProvider({ children }) {
  const { user } = useAuth();
  const toast = useToast();
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);
  const [unread, setUnread] = useState(0);
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const refreshUnread = useCallback(async () => {
    try { setUnread((await get('/notifications/unread-count')).unread); } catch { /* ignore */ }
  }, []);

  const uid = user?._id;
  const blocked = user?.mustChangePassword;
  useEffect(() => {
    if (!uid || blocked) { setSocket(null); setConnected(false); setUnread(0); return undefined; }
    const s = io({ withCredentials: true, reconnectionDelayMax: 8000 });
    setSocket(s);
    s.on('connect', () => { setConnected(true); refreshUnread(); });
    s.on('disconnect', () => setConnected(false));
    s.on('notification:new', (n) => {
      setUnread((c) => c + 1);
      if (n.type !== 'chat_message') toastRef.current.info(n.title);
    });
    refreshUnread();
    return () => { s.close(); };
  }, [uid, blocked, refreshUnread]);

  const value = useMemo(() => ({ socket, connected, unread, setUnread, refreshUnread }), [socket, connected, unread, refreshUnread]);
  return <SocketCtx.Provider value={value}>{children}</SocketCtx.Provider>;
}
