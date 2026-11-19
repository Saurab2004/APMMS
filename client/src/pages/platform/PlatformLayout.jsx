import BrandMark from '../../components/common/BrandMark.jsx';
import { useEffect, useState } from 'react';
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Activity, Building2, ChevronDown, LayoutDashboard, LogOut, Menu, PanelLeftClose, PanelLeftOpen, ScrollText, Settings, ShieldCheck, UserCircle, UserCog, Users } from 'lucide-react';
import { usePlatformAuth } from '../../context/PlatformAuthContext.jsx';
import { Avatar, Breadcrumbs, IconButton, Loading } from '../../components/common/ui.jsx';
import { cx, titleCase } from '../../utils/format.js';

const NAV = [
  { title: 'Platform', items: [
    { to: '/platform', label: 'Overview', icon: LayoutDashboard, end: true },
    { to: '/platform/institutions', label: 'Institutions', icon: Building2 },
    { to: '/platform/coordinators', label: 'Coordinators', icon: Users },
  ] },
  { title: 'Administration', items: [
    { to: '/platform/admins', label: 'Admins', icon: UserCog },
    { to: '/platform/audit', label: 'Audit log', icon: ScrollText },
    { to: '/platform/health', label: 'System health', icon: Activity },
    { to: '/platform/settings', label: 'Settings', icon: Settings },
  ] },
];

/** Keeps signed-out visitors out, and forces the temporary password to be changed first. */
export function PlatformGuard() {
  const { admin, loading } = usePlatformAuth();
  const { pathname } = useLocation();
  if (loading) return <div style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center' }}><Loading text="Loading the admin console..." /></div>;
  if (!admin) return <Navigate to="/login" replace state={{ role: 'platform' }} />;
  if (admin.mustChangePassword && pathname !== '/platform/change-password') return <Navigate to="/platform/change-password" replace />;
  return <Outlet />;
}

function crumbs(pathname) {
  const parts = pathname.split('/').filter(Boolean).slice(1);
  const out = [{ label: 'Platform admin', to: '/platform' }];
  let acc = '/platform';
  parts.forEach((p, i) => {
    acc += `/${p}`;
    out.push({ label: /^[a-f0-9]{24}$/i.test(p) ? 'Details' : titleCase(p.replace(/-/g, ' ')), to: i < parts.length - 1 ? acc : undefined });
  });
  return out;
}

export default function PlatformLayout() {
  const { admin, logout } = usePlatformAuth();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [menu, setMenu] = useState(false);
  useEffect(() => { setDrawer(false); setMenu(false); }, [pathname]);
  useEffect(() => {
    if (!menu) return undefined;
    const close = (e) => { if (!e.target.closest?.('.dropdown')) setMenu(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menu]);

  return (
    <div className={cx('app', collapsed && 'collapsed', drawer && 'drawer-open')}>
      <aside className="sidebar" aria-label="Platform navigation">
        <Link to="/platform" className="sidebar-brand">
          <BrandMark />
          <span className="brand-text">APMMS<small>Platform admin</small></span>
        </Link>
        <nav className="sidebar-nav">
          {NAV.map((g) => (
            <div className="nav-group" key={g.title}>
              <div className="nav-title">{g.title}</div>
              {g.items.map((it) => (
                <NavLink key={it.to} to={it.to} end={it.end} className={({ isActive }) => cx('nav-link', isActive && 'active')} title={collapsed ? it.label : undefined}>
                  <it.icon size={19} aria-hidden="true" /><span className="nav-label">{it.label}</span>
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
          <Breadcrumbs items={crumbs(pathname)} />
          <div className="header-spacer" />
          <div className="dropdown">
            <button type="button" className="user-btn" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
              <Avatar name={admin.name} />
              <span className="user-name" style={{ textAlign: 'left', lineHeight: 1.2 }}>
                <strong style={{ fontSize: 'var(--fs-label)' }}>{admin.name}</strong><br /><span className="muted" style={{ fontSize: 'var(--fs-help)' }}>{admin.isFounder ? 'Founding admin' : 'Platform admin'}</span>
              </span>
              <ChevronDown size={15} className="user-name" />
            </button>
            {menu && (
              <div className="dropdown-menu" role="menu">
                <div className="dropdown-head"><strong>{admin.name}</strong><div className="muted small">{admin.email}</div></div>
                <Link className="dropdown-item" role="menuitem" to="/platform/account"><UserCircle size={17} />My account</Link>
                <button className="dropdown-item" role="menuitem" type="button" onClick={async () => { await logout(); navigate('/login', { state: { role: 'platform' } }); }}><LogOut size={17} />Log out</button>
              </div>
            )}
          </div>
        </header>
        <main className="content" id="main"><Outlet /></main>
      </div>
    </div>
  );
}
