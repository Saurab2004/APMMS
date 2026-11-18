import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowLeft, MessagesSquare, Paperclip, Send, Search, X, FileText, Check, CheckCheck } from 'lucide-react';
import { Button, Card, EmptyState, Loading, PageHeader, Alert, Badge } from '../../components/common/ui.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useSocket } from '../../context/SocketContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { FileViewerDialog, canView } from '../../components/files/FileViewer.jsx';
import { api, downloadFile, errMsg, get, getPaged } from '../../services/api.js';
import { cx, fmtBytes, fmtDateTime, fmtTime, timeAgo } from '../../utils/format.js';

const ACCEPT = ['pdf', 'docx', 'png', 'jpg', 'jpeg', 'txt', 'zip'];

function Message({ m, mine, convId, othersCount }) {
  const [viewing, setViewing] = useState(null);
  const readByOthers = (m.readBy || []).filter((r) => String(r.user) !== String(m.sender?._id || m.sender)).length;
  return (
    <div className={cx('msg', mine && 'mine')}>
      <div className="msg-meta">
        {!mine && <strong>{m.sender?.name}</strong>}
        {!mine && <Badge tone={m.senderRole === 'supervisor' ? 'indigo' : 'neutral'}>{m.senderRole}</Badge>}
        <span title={fmtDateTime(m.createdAt)}>{fmtTime(m.createdAt)}</span>
        {mine && (readByOthers > 0 ? <CheckCheck size={14} color="var(--primary)" aria-label="Read" /> : <Check size={14} aria-label="Sent" />)}
      </div>
      <div className="bubble">
        {m.text}
        {(m.attachments || []).map((a, i) => (
          <div key={i} style={{ marginTop: m.text ? 6 : 0 }}>
            <a href="#download" onClick={(e) => { e.preventDefault(); downloadFile(`/conversations/${convId}/messages/${m._id}/attachments/${i}`, a.originalName); }}>
              <FileText size={14} style={{ verticalAlign: '-2px' }} /> {a.originalName} <small>({fmtBytes(a.size)})</small>
            </a>
            {canView(a) && <> <a href="#view" onClick={(e) => { e.preventDefault(); setViewing({ ...a, i }); }}>View</a></>}
          </div>
        ))}
        {viewing && <FileViewerDialog url={`/conversations/${convId}/messages/${m._id}/attachments/${viewing.i}`} file={viewing} onClose={() => setViewing(null)} />}
      </div>
    </div>
  );
}

export default function ChatPage() {
  const { user } = useAuth();
  const { socket, connected, refreshUnread } = useSocket();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [convs, setConvs] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [activeId, setActiveId] = useState(params.get('c') || '');
  const [messages, setMessages] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [text, setText] = useState('');
  const [files, setFiles] = useState([]);
  const [sending, setSending] = useState(false);
  const [typing, setTyping] = useState('');
  const [search, setSearch] = useState('');
  const bodyRef = useRef(null);
  const typingTimer = useRef(null);
  const activeRef = useRef(activeId);
  activeRef.current = activeId;

  const loadConvs = useCallback(async () => {
    try { setConvs(await get('/conversations')); setLoadError(''); } catch (e) { setLoadError(errMsg(e)); setConvs([]); }
  }, []);
  useEffect(() => { loadConvs(); }, [loadConvs]);

  const active = useMemo(() => (convs || []).find((c) => c._id === activeId), [convs, activeId]);

  const loadMessages = useCallback(async (id, { before, q } = {}) => {
    setLoadingMsgs(true);
    try {
      const r = await getPaged(`/conversations/${id}/messages`, { before, q: q || undefined, limit: 30 });
      setHasMore(Boolean(r.meta.hasMore));
      setMessages((prev) => (before ? [...r.items, ...prev] : r.items));
      if (!before && !q) { await api.post(`/conversations/${id}/read`); refreshUnread(); setConvs((cs) => cs?.map((c) => (c._id === id ? { ...c, unread: 0 } : c))); }
    } catch (e) { toast.error(errMsg(e)); } finally { setLoadingMsgs(false); }
  }, [refreshUnread, toast]);

  useEffect(() => {
    setMessages([]); setSearch('');
    if (activeId) { loadMessages(activeId); socket?.emit('conversation:join', activeId); }
  }, [activeId, loadMessages, socket]);

  useEffect(() => { if (!search) bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight }); }, [messages.length, search]);

  // live events
  useEffect(() => {
    if (!socket) return undefined;
    const onMsg = (m) => {
      const cid = String(m.conversation);
      if (cid === activeRef.current) {
        setMessages((prev) => (prev.some((x) => x._id === m._id) ? prev : [...prev, m]));
        if (String(m.sender?._id) !== String(user._id)) api.post(`/conversations/${cid}/read`).then(refreshUnread).catch(() => {});
      }
      setConvs((cs) => cs?.map((c) => (c._id === cid ? { ...c, lastMessage: { text: m.text || 'Attachment', at: m.createdAt, fromMe: String(m.sender?._id) === String(user._id) }, unread: cid === activeRef.current || String(m.sender?._id) === String(user._id) ? 0 : (c.unread || 0) + 1 } : c)));
    };
    const onTyping = (t) => {
      if (t.conversationId !== activeRef.current) return;
      setTyping(t.isTyping ? `${t.name} is typing...` : '');
      clearTimeout(typingTimer.current);
      if (t.isTyping) typingTimer.current = setTimeout(() => setTyping(''), 3500);
    };
    const onRead = (r) => { if (r.conversationId === activeRef.current) setMessages((prev) => prev.map((m) => ({ ...m, readBy: [...(m.readBy || []), { user: r.userId }] }))); };
    socket.on('message:new', onMsg);
    socket.on('typing', onTyping);
    socket.on('conversation:read', onRead);
    socket.on('connect', () => { loadConvs(); if (activeRef.current) loadMessages(activeRef.current); }); // catch up after a reconnect
    return () => { socket.off('message:new', onMsg); socket.off('typing', onTyping); socket.off('conversation:read', onRead); };
  }, [socket, user._id, refreshUnread, loadConvs, loadMessages]);

  const choose = (id) => { setActiveId(id); setParams(id ? { c: id } : {}, { replace: true }); };

  const onType = (v) => {
    setText(v);
    if (activeId) socket?.emit('typing', { conversationId: activeId, isTyping: v.length > 0 });
  };

  const addFiles = (picked) => {
    const arr = [...picked];
    for (const f of arr) {
      const ext = f.name.split('.').pop().toLowerCase();
      if (!ACCEPT.includes(ext)) return toast.error(`".${ext}" files are not allowed in chat`);
      if (f.size > 10 * 1024 * 1024) return toast.error(`${f.name} is larger than 10 MB`);
    }
    setFiles((prev) => [...prev, ...arr].slice(0, 3));
  };

  const send = async (e) => {
    e.preventDefault();
    if (!text.trim() && !files.length) return;
    setSending(true);
    try {
      const fd = new FormData();
      fd.append('text', text);
      files.forEach((f) => fd.append('attachments', f));
      const r = await api.post(`/conversations/${activeId}/messages`, fd);
      const m = r.data.data;
      setMessages((prev) => (prev.some((x) => x._id === m._id) ? prev : [...prev, m]));
      setText(''); setFiles([]);
      socket?.emit('typing', { conversationId: activeId, isTyping: false });
      loadConvs();
    } catch (err) { toast.error(errMsg(err)); } finally { setSending(false); }
  };

  const doSearch = (e) => { e.preventDefault(); if (activeId) loadMessages(activeId, { q: search }); };

  if (!convs) return <Loading />;
  return (
    <>
      <PageHeader title="Project chat" subtitle="Team chat and supervisor chat. Messages are saved and visible only to the people in the conversation." />
      {loadError && <Alert tone="danger" className="mb">{loadError}</Alert>}
      {!connected && <Alert tone="warning" className="mb">Live connection lost - reconnecting. You can still read and send messages.</Alert>}
      {!convs.length ? (
        <Card><EmptyState icon={MessagesSquare} title="No conversations yet">{user.role === 'student' ? 'Join or create a group to start chatting.' : 'Conversations appear when projects are assigned to you.'}</EmptyState></Card>
      ) : (
        <Card className={cx('chat', activeId && 'has-active')}>
          <div className="chat-list" role="list">
            {convs.map((c) => (
              <button key={c._id} type="button" role="listitem" className={cx('chat-item', c._id === activeId && 'active')} onClick={() => choose(c._id)}>
                <div className="top"><strong className="truncate">{c.title}</strong>{c.unread > 0 && <span className="unread-pill">{c.unread}</span>}</div>
                <div className="preview">{c.lastMessage ? `${c.lastMessage.fromMe ? 'You: ' : ''}${c.lastMessage.text}` : 'No messages yet'}</div>
                {c.lastMessage?.at && <div className="muted small">{timeAgo(c.lastMessage.at)}</div>}
              </button>
            ))}
          </div>
          {active ? (
            <div className="chat-pane">
              <div className="chat-head">
                <button type="button" className="btn btn-ghost btn-icon back-btn" onClick={() => choose('')} aria-label="Back to conversations"><ArrowLeft size={18} /></button>
                <div className="grow"><strong>{active.title}</strong><div className="muted small truncate">{active.type === 'supervision' ? `Students and ${active.supervisor?.name || 'supervisor'}` : 'Students only'} - {active.projectTitle}</div></div>
                <form onSubmit={doSearch} className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
                  <input className="input" style={{ width: 130, minHeight: 36 }} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search" aria-label="Search messages" />
                  {search ? <button type="button" className="btn btn-ghost btn-icon" aria-label="Clear search" onClick={() => { setSearch(''); loadMessages(activeId); }}><X size={16} /></button> : <button className="btn btn-ghost btn-icon" aria-label="Search"><Search size={16} /></button>}
                </form>
              </div>
              <div className="chat-body" ref={bodyRef} aria-live="polite">
                {hasMore && <Button variant="secondary" size="sm" onClick={() => loadMessages(activeId, { before: messages[0]?.createdAt })} loading={loadingMsgs} style={{ alignSelf: 'center' }}>Load earlier messages</Button>}
                {loadingMsgs && !messages.length ? <Loading /> : !messages.length ? <p className="muted center">{search ? 'No messages match your search.' : 'Say hello to start the conversation.'}</p> :
                  messages.map((m) => <Message key={m._id} m={m} mine={String(m.sender?._id || m.sender) === String(user._id)} convId={activeId} />)}
              </div>
              <div className="typing" aria-live="polite">{typing}</div>
              <form className="chat-compose" onSubmit={send}>
                {files.length > 0 && <div style={{ width: '100%' }} className="row">{files.map((f, i) => <span key={i} className="badge badge-neutral">{f.name} <button type="button" aria-label={`Remove ${f.name}`} style={{ border: 0, background: 'none', padding: 0 }} onClick={() => setFiles(files.filter((_, j) => j !== i))}><X size={12} /></button></span>)}</div>}
                <label className="btn btn-secondary btn-icon" title="Attach file (PDF, DOCX, image, TXT, ZIP - max 3)">
                  <Paperclip size={18} /><span className="sr-only">Attach file</span>
                  <input type="file" hidden multiple onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
                </label>
                <textarea className="textarea" rows={1} value={text} maxLength={2000} placeholder="Write a message..." aria-label="Message" onChange={(e) => onType(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.currentTarget.form.requestSubmit(); } }} />
                <Button type="submit" icon={Send} loading={sending} disabled={!text.trim() && !files.length}>Send</Button>
              </form>
            </div>
          ) : <div className="chat-pane"><EmptyState icon={MessagesSquare} title="Choose a conversation" /></div>}
        </Card>
      )}
    </>
  );
}
