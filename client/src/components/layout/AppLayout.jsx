import BrandMark from '../common/BrandMark.jsx';
import { useEffect, useState } from 'react';
import { NavLink, Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { GraduationCap, Menu, PanelLeftClose, PanelLeftOpen, Bell, LogOut, UserCircle, Settings, ChevronDown, Wifi, WifiOff } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { useSocket } from '../../context/SocketContext.jsx';
import { navFor, ROLE_LABEL } from './navConfig.js';
import { Avatar, Breadcrumbs, IconButton } from '../common/ui.jsx';
import { cx, titleCase } from '../../utils/format.js';
import WelcomeGuide from '../onboarding/WelcomeGuide.jsx';

function crumbsFor(pathname, role) {
  const parts = pathname.split('/').filter(Boolean);
  const out = [{ label: ROLE_LABEL[role] || 'Home', to: `/${role}` }];
  let acc = `/${parts[0]}`;
  parts.slice(1).forEach((p, i, arr) => {
    acc += `/${p}`;
    const isId = /^[a-f0-9]{24}$/i.test(p);
    out.push({ label: isId ? 'Details' : titleCase(p.replace(/-/g, ' ')), to: i < arr.length - 1 ? acc : undefined });
  });
  return out;
}

export default function AppLayout() {
  const { user, logout } = useAuth();
  const { unread, connected } = useSocket();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem('apmms.nav') === '1'; } catch { return false; } });
  const [drawer, setDrawer] = useState(false);
  const [menu, setMenu] = useState(false);

  useEffect(() => { setDrawer(false); setMenu(false); }, [pathname]);
  useEffect(() => { try { localStorage.setItem('apmms.nav', collapsed ? '1' : '0'); } catch { /* ignore */ } }, [collapsed]);
  useEffect(() => {
    if (!menu) return undefined;
    const close = (e) => { if (!e.target.closest?.('.dropdown')) setMenu(false); };
    const esc = (e) => e.key === 'Escape' && setMenu(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [menu]);

  const groups = navFor(user);
  const base = `/${user.role}`;
  const notifTo = user.role === 'evaluator' ? base : `${base}/notifications`;
  const profileTo = user.role === 'coordinator' ? `${base}/account` : user.role === 'evaluator' ? `${base}/account` : `${base}/profile`;
  const settingsTo = user.role === 'coordinator' ? `${base}/account` : user.role === 'evaluator' ? `${base}/account` : `${base}/settings`;

  return (
    <div className={cx('app', collapsed && 'collapsed', drawer && 'drawer-open')}>
      <aside className="sidebar" aria-label="Main navigation">
        <Link to={base} className="sidebar-brand">
          <BrandMark />
          <span className="brand-text">APMMS<small>{user.institution?.name || 'Project management'}</small></span>
        </Link>
        <nav className="sidebar-nav">
          {groups.map((g) => (
            <div className="nav-group" key={g.title}>
              <div className="nav-title">{g.title}</div>
              {g.items.map((it) => (
                <NavLink key={it.to} to={it.to} end={it.end} className={({ isActive }) => cx('nav-link', isActive && 'active')} title={collapsed ? it.label : undefined}>
                  <it.icon size={19} aria-hidden="true" />
                  <span className="nav-label">{it.label}</span>
                  {it.badgeKey === 'unread' && unread > 0 && <span className="nav-badge">{unread > 99 ? '99+' : unread}</span>}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-foot collapse-btn">
          <button type="button" className="btn btn-ghost btn-block" onClick={() => setCollapsed((c) => !c)} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
            {collapsed ? <PanelLeftOpen size={18} /> : <><PanelLeftClose size={18} /><span className="nav-label">Collapse</span></>}
          </button>
        </div>
      </aside>
      <div className="scrim" onClick={() => setDrawer(false)} aria-hidden="true" />

      <div className="main">
        <header className="header">
          <IconButton icon={Menu} label="Open menu" className="menu-btn" onClick={() => setDrawer(true)} />
          <Breadcrumbs items={crumbsFor(pathname, user.role)} />
          <div className="header-spacer" />
          <span className="row small muted" title={connected ? 'Live updates connected' : 'Live updates reconnecting...'} style={{ gap: 4 }}>
            {connected ? <Wifi size={15} color="var(--success)" /> : <WifiOff size={15} />}
          </span>
          <div className="bell">
            <IconButton icon={Bell} label={`Notifications${unread ? ` (${unread} unread)` : ''}`} onClick={() => navigate(notifTo)} />
            {unread > 0 && <span className="dot" aria-hidden="true">{unread > 99 ? '99+' : unread}</span>}
          </div>
          <div className="dropdown">
            <button type="button" className="user-btn" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
              <Avatar name={user.name} />
              <span className="user-name" style={{ textAlign: 'left', lineHeight: 1.2 }}>
                <strong style={{ fontSize: 'var(--fs-label)' }}>{user.name}</strong><br /><span className="muted" style={{ fontSize: 'var(--fs-help)' }}>{ROLE_LABEL[user.role]}</span>
              </span>
              <ChevronDown size={15} className="user-name" />
            </button>
            {menu && (
              <div className="dropdown-menu" role="menu">
                <div className="dropdown-head"><strong>{user.name}</strong><div className="muted small">{user.email}</div></div>
                <Link className="dropdown-item" role="menuitem" to={profileTo}><UserCircle size={17} />Profile</Link>
                <Link className="dropdown-item" role="menuitem" to={settingsTo}><Settings size={17} />Settings</Link>
                <button className="dropdown-item" role="menuitem" type="button" onClick={async () => { await logout(); navigate('/login'); }}><LogOut size={17} />Log out</button>
              </div>
            )}
          </div>
        </header>
        <main className="content" id="main">
          <Outlet />
          <WelcomeGuide />
        </main>
      </div>
    </div>
  );
}
