// ============================================================
// AppShell.tsx — Khung bố cục chính: sidebar + header + nội dung trang
// Sidebar có thể thu gọn/mở rộng, trạng thái lưu vào localStorage
// Điều hướng lọc theo vai trò người dùng (admin / manager / operator)
// ============================================================

import { useEffect, useState, Suspense } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { authService } from '@/services/AuthService';
import {
  LayoutDashboard, Video, AlertTriangle, LineChart, FileText,
  Wrench, FileArchive, Map, Radio, Users, Settings2, Settings, LogOut,
  ChevronLeft, ChevronRight
} from 'lucide-react';

interface NavSubItem { id: string; path: string; label: string }
// roles: undefined = tất cả vai trò; có giá trị = chỉ vai trò trong mảng mới thấy
interface NavItem { id: string; path: string; icon: React.ReactNode; label: string; roles?: string[]; children?: NavSubItem[] }

// ── Điều hướng chính ─────────────────────────────────────────
// TODO (production): thêm field `roles` để lọc theo vai trò
const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', path: '/dashboard', icon: <LayoutDashboard size={19} strokeWidth={1.5} />, label: 'Tổng quan' },
  { id: 'realtime', path: '/realtime', icon: <Video size={19} strokeWidth={1.5} />, label: 'Giám sát RT' },
  { id: 'alerts-history', path: '/alerts-history', icon: <AlertTriangle size={19} strokeWidth={1.5} />, label: 'Nhật ký' },
  { id: 'analytics', path: '/analytics', icon: <LineChart size={19} strokeWidth={1.5} />, label: 'Phân tích' },
  { id: 'reports', path: '/reports', icon: <FileText size={19} strokeWidth={1.5} />, label: 'Báo cáo' },
  { id: 'maintenance', path: '/maintenance', icon: <Wrench size={19} strokeWidth={1.5} />, label: 'Bảo trì' },
  { id: 'audit-log', path: '/audit-log', icon: <FileArchive size={19} strokeWidth={1.5} />, label: 'Audit Log' },
  { id: 'multisite', path: '/multisite', icon: <Map size={19} strokeWidth={1.5} />, label: 'Đa trạm' },
];

// ── Nhóm quản trị ────────────────────────────────────────────
// TODO (production): thêm field `roles: ['admin']` khi phân quyền
const ADMIN_NAV: NavItem[] = [
  { id: 'device-management', path: '/device-management', icon: <Radio size={19} strokeWidth={1.5} />, label: 'Thiết bị' },
  { id: 'user-management', path: '/user-management', icon: <Users size={19} strokeWidth={1.5} />, label: 'Người dùng' },
  { id: 'rule-engine', path: '/rule-engine', icon: <Settings2 size={19} strokeWidth={1.5} />, label: 'Rule Engine' },
];

export default function AppShell() {
  const navigate = useNavigate();
  const user = authService.getUser() || { fullname: 'User', role: 'user' };
  const [time, setTime] = useState(new Date().toLocaleTimeString('vi-VN'));
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  // Sidebar mở rộng mặc định; lưu preference vào localStorage
  const [expanded, setExpanded] = useState(
    () => localStorage.getItem('sidebar-expanded') !== 'false'
  );
  const [theme, setThemeState] = useState<string>(
    () => localStorage.getItem('station-theme') || 'dark'
  );

  useEffect(() => {
    // Áp dụng theme đã lưu ngay khi shell mount
    const savedTheme = localStorage.getItem('station-theme') || 'dark';
    document.documentElement.dataset.theme = savedTheme;
    document.documentElement.classList.remove('theme-blue', 'theme-dark', 'theme-light');
    document.documentElement.classList.add(`theme-${savedTheme}`);

    const handleThemeChange = (e: Event) => {
      const customEv = e as CustomEvent;
      const newTheme = customEv.detail?.theme;
      if (newTheme) {
        setThemeState(newTheme);
      }
    };
    window.addEventListener('theme-changed', handleThemeChange);

    // Đồng hồ realtime cập nhật mỗi giây
    const t = setInterval(() => setTime(new Date().toLocaleTimeString('vi-VN')), 1000);
    return () => {
      clearInterval(t);
      window.removeEventListener('theme-changed', handleThemeChange);
    };
  }, []);

  const toggle = () => {
    const next = !expanded;
    setExpanded(next);
    localStorage.setItem('sidebar-expanded', String(next));
  };

  const handleLogout = () => {
    authService.logout();
    navigate('/login');
    window.location.reload(); // reset toàn bộ state app
  };

  // Lọc menu theo role rồi render NavLink có hỗ trợ sub-menu khi active
  const renderNav = (items: NavItem[]) =>
    items
      .filter(i => !i.roles || i.roles.includes(user.role))
      .map(i => {
        const hasChildren = i.children && i.children.length > 0;
        const isCurrentActive = window.location.pathname.startsWith(i.path);

        const targetPath = (hasChildren && i.children && i.children[0]) ? i.children[0].path : i.path;

        return (
          <div key={i.id} style={{ display: 'flex', flexDirection: 'column' }}>
            <NavLink
              to={targetPath}
              className={({ isActive }) => `nav-item${(isActive || isCurrentActive) ? ' active' : ''}`}
              title={!expanded ? i.label : undefined}
              end={!hasChildren}
            >
              <span className="nav-icon">{i.icon}</span>
              <span className={`nav-label${expanded ? ' nav-label--visible' : ''}`}>{i.label}</span>
              {hasChildren && expanded && (
                <span className="sub-chevron" style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', opacity: 0.5, transform: isCurrentActive ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}>
                  <ChevronRight size={12} strokeWidth={2.5} />
                </span>
              )}
            </NavLink>
            {hasChildren && expanded && isCurrentActive && (
              <div className="sb-sub-tree">
                {i.children!.map(child => (
                  <NavLink
                    key={child.id}
                    to={child.path}
                    className={({ isActive }) => `sb-sub-item${isActive ? ' active' : ''}`}
                  >
                    {child.label}
                  </NavLink>
                ))}
              </div>
            )}
          </div>
        );
      });

  const themeClass = `theme-${theme}`;

  return (
    <div className={`app-shell admin-container ${themeClass}`}>

      {/* ── Full-width header (independent of sidebar) ── */}
      <header className="admin-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <img
            alt="StationOS"
            src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMDAgMTAwIj48ZGVmcz48bGluZWFyR3JhZGllbnQgaWQ9ImdyYWQiIHgxPSIwJSIgeTE9IjAlIiB4Mj0iMTAwJSIgeTI9IjEwMCUiPjxzdG9wIG9mZnNldD0iMCUiIHN0b3AtY29sb3I9IiM0NGZmODgiIC8+PHN0b3Agb2Zmc2V0PSIxMDAlIiBzdG9wLWNvbG9yPSIjMDI4NGM3IiAvPjwvbGluZWFyR3JhZGllbnQ+PGZpbHRlciBpZD0iZ2xvdyI+PGZlR2F1c3NpYW5CbHVyIHN0ZERldmlhdGlvbj0iMyIgcmVzdWx0PSJjb2xvcmVkQmx1ciIvPjxmZU1lcmdlPjxmZU1lcmdlTm9kZSBpbj0iY29sb3JlZEJsdXIiLz48ZmVNZXJnZU5vZGUgaW49IlNvdXJjZUdyYXBoaWMiLz48L2ZlTWVyZ2U+PC9maWx0ZXI+PC9kZWZzPjxjaXJjbGUgY3g9IjUwIiBjeT0iNTAiIHI9IjQ1IiBmaWxsPSJub25lIiBzdHJva2U9InVybCgjZ3JhZCkiIHN0cm9rZS13aWR0aD0iNiIgZmlsdGVyPSJ1cmwoI2dsb3cpIi8+PHBhdGggZD0iTTUwIDE1IEw4MCAzNSBMODAgNjUgTDUwIDg1IEwyMCA2NSBMMjAgMzUgWiIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjZmZmZmZmIiBzdHJva2Utd2lkdGg9IjMiIG9wYWNpdHk9IjAuNSIvPjxwYXRoIGQ9Ik01NSAyNSBMMzUgNTUgTDUwIDU1IEw0NSA3NSBMNjUgNDUgTDUwIDQ1IFoiIGZpbGw9IiM0NGZmODgiIGZpbHRlcj0idXJsKCNnbG93KSIvPjwvc3ZnPg=="
            style={{ width: 30, height: 30, flexShrink: 0 }}
          />
          <span style={{ fontWeight: 800, fontSize: '1.05rem', color: 'var(--admin-text)', letterSpacing: '.5px' }}>
            HỆ THỐNG GIÁM SÁT <span style={{ color: 'var(--admin-accent)' }}>TRẠM ĐIỆN</span>
          </span>
          <span className="version-badge">v{__APP_VERSION__}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
          <div className="header-clock">{time}</div>
          <div className="header-divider" />
          <div className="header-user">
            <span className="user-avatar">{user.fullname?.[0] || 'U'}</span>
            <span style={{ fontSize: '.85rem', color: 'var(--admin-text)', fontWeight: 600 }}>{user.fullname}</span>
            {user.role && user.role.toLowerCase() !== 'user' && user.role.toLowerCase() !== user.fullname.toLowerCase() && (
              <span className={`role-badge role-${user.role}`}>{user.role.toUpperCase()}</span>
            )}
          </div>
        </div>
      </header>

      {/* ── Body: sidebar + content ── */}
      <div className="app-body">

        {/* ── Sidebar wrapper ── */}
        <div className={`sb-wrap${expanded ? ' expanded' : ''}`}>
          <nav className="sidebar-nav" id="sidebarNav">

            {/* ── Scrollable nav body ── */}
            <div className="sb-body">
              <div className="sb-group">
                <div className={`sb-group__label${expanded ? '' : ' hidden'}`}>ĐIỀU HƯỚNG</div>
                {renderNav(NAV_ITEMS)}
              </div>

              <div className="sb-sep" />

              <div className="sb-group">
                <div className={`sb-group__label${expanded ? '' : ' hidden'}`}>QUẢN TRỊ</div>
                {renderNav(ADMIN_NAV)}
              </div>
            </div>

            {/* ── Bottom actions (pinned) ── */}
            <div className="sb-bottom">
              <div className="sb-sep" />
              <NavLink to="/settings" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`} title={!expanded ? 'Cài đặt' : undefined}>
                <span className="nav-icon"><Settings size={19} strokeWidth={1.5} /></span>
                <span className={`nav-label${expanded ? ' nav-label--visible' : ''}`}>Cài đặt</span>
              </NavLink>
              <div className="nav-item nav-item--logout" onClick={() => setShowLogoutModal(true)} title={!expanded ? 'Đăng xuất' : undefined}>
                <span className="nav-icon"><LogOut size={19} strokeWidth={1.5} /></span>
                <span className={`nav-label${expanded ? ' nav-label--visible' : ''}`}>Đăng xuất</span>
              </div>
            </div>

          </nav>

          {/* Toggle chevron — outside nav so overflow:hidden doesn't clip it */}
          <button className="sb-toggle" onClick={toggle} title={expanded ? 'Thu gọn' : 'Mở rộng'}>
            {expanded ? <ChevronLeft size={12} strokeWidth={2.5} /> : <ChevronRight size={12} strokeWidth={2.5} />}
          </button>
        </div>

        {/* ── Main view ── */}
        <div className="main-view">
          <div className="page-content">
            <Suspense fallback={null}>
              <Outlet />
            </Suspense>
          </div>
        </div>

      </div>{/* end .app-body */}

      {/* ── Logout modal ── */}
      {showLogoutModal && (
        <div className="modal-overlay active">
          <div className="modal-content" style={{ width: 380, textAlign: 'center' }}>
            <div className="modal-body" style={{ padding: '32px 24px' }}>
              <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'center' }}>
                <LogOut size={48} strokeWidth={1.5} color="var(--admin-danger)" />
              </div>
              <h3 style={{ margin: '0 0 8px', color: 'var(--admin-text, var(--admin-text))' }}>Đăng xuất</h3>
              <p style={{ margin: 0, opacity: 0.6, fontSize: '.9rem' }}>Bạn có chắc muốn đăng xuất khỏi hệ thống?</p>
            </div>
            <div className="modal-footer" style={{ justifyContent: 'center', gap: 12 }}>
              <button onClick={() => setShowLogoutModal(false)} className="btn-industrial" style={{ minWidth: 100 }}>Hủy</button>
              <button onClick={handleLogout} className="btn-industrial btn-danger" style={{ minWidth: 100 }}>Đăng xuất</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
