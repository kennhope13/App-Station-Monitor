// ============================================================
// AppShell.tsx — Khung bố cục chính: sidebar + header + nội dung trang
// Sidebar có thể thu gọn/mở rộng, trạng thái lưu vào localStorage
// Điều hướng lọc theo vai trò người dùng (admin / manager / operator)
// ============================================================

import { useEffect, useState, Suspense, useRef } from 'react';
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { authService } from '@/services/AuthService';
import { useAlertStore, useSensorStore } from '@/store';
import { ALERT_STATUS } from '@/types/enums';
import type { AlertItem, SensorPoint } from '@/types/api.types';
import { setTheme as setGlobalTheme } from '@/utils/theme-manager';
import { showToast } from '@/utils/toast';
import { playAlertSound } from '@/utils/sound-utils';
import { createRealtimeHub } from '@/services/realtime.service';
import RichAlertModal from '@/components/ui/RichAlertModal';
import {
  LayoutDashboard, Video, AlertTriangle, LineChart, FileText,
  Wrench, FileArchive, Map, Radio, Users, Settings, LogOut,
  ChevronLeft, ChevronRight, Moon, Sun
} from 'lucide-react';

interface NavSubItem { id: string; path: string; label: string }
// roles: undefined = tất cả vai trò; có giá trị = chỉ vai trò trong mảng mới thấy
interface NavItem { id: string; path: string; icon: React.ReactNode; label: string; roles?: string[]; children?: NavSubItem[] }

// ── Điều hướng chính ─────────────────────────────────────────
// TODO (production): thêm field `roles` để lọc theo vai trò
const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', path: '/dashboard', icon: <LayoutDashboard size={19} strokeWidth={1.5} />, label: 'Tổng quan' },
  { id: 'realtime', path: '/realtime', icon: <Video size={19} strokeWidth={1.5} />, label: 'Trực tiếp' },
  { id: 'alerts-history', path: '/alerts-history', icon: <AlertTriangle size={19} strokeWidth={1.5} />, label: 'Lịch sử cảnh báo' },
  { id: 'analytics', path: '/analytics', icon: <LineChart size={19} strokeWidth={1.5} />, label: 'Phân tích' },
  { id: 'reports', path: '/reports', icon: <FileText size={19} strokeWidth={1.5} />, label: 'Báo cáo' },
  { id: 'maintenance', path: '/maintenance', icon: <Wrench size={19} strokeWidth={1.5} />, label: 'Bảo trì' },
  { id: 'audit-log', path: '/audit-log', icon: <FileArchive size={19} strokeWidth={1.5} />, label: 'Nhật ký hệ thống' },
  { id: 'multisite', path: '/multisite', icon: <Map size={19} strokeWidth={1.5} />, label: 'Đa trạm' },
];

// ── Nhóm quản trị ────────────────────────────────────────────
// TODO (production): thêm field `roles: ['admin']` khi phân quyền
const ADMIN_NAV: NavItem[] = [
  { id: 'device-management', path: '/device-management', icon: <Radio size={19} strokeWidth={1.5} />, label: 'Thiết bị' },
  { id: 'user-management', path: '/user-management', icon: <Users size={19} strokeWidth={1.5} />, label: 'Người dùng' },
  { id: 'settings', path: '/settings', icon: <Settings size={19} strokeWidth={1.5} />, label: 'Cài đặt' },
];

const THEME_NAMES: Record<string, string> = {
  dark: 'Tối',
  light: 'Trắng',
  'soft-light': 'Dịu mắt',
  silver: 'Bạc',
  industrial: 'Công nghiệp',
  hightech: 'Hiện đại',
  cyberpunk: 'Neon'
};

/**
 * Khung bố cục chính của ứng dụng — gồm header, sidebar thu gọn/mở rộng và vùng nội dung trang.
 * Quản lý SignalR toàn cục, xử lý cảnh báo mới, đồng bộ cảm biến và điều hướng theo vai trò.
 */
export default function AppShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const user = authService.getUser() || { fullname: 'Người dùng', role: 'user' };

  // ── Alerts Management ────────────────────────────────────────
  const [activeAlert, setActiveAlert] = useState<AlertItem | null>(null);
  const fetchAlerts = useAlertStore(s => s.fetch);
  const invalidateAlerts = useAlertStore(s => s.invalidate);
  
  useEffect(() => {
    fetchAlerts(ALERT_STATUS.OPEN);

    // Khởi tạo SignalR Hub toàn cục để lắng nghe mọi sự kiện trên mọi Tab
    const hub = createRealtimeHub();

    // 1. Lắng nghe cảnh báo mới từ Rule Engine, Camera, Maintenance
    hub.on('AlertNew', (alert: AlertItem) => {
      invalidateAlerts(ALERT_STATUS.OPEN);
      fetchAlerts(ALERT_STATUS.OPEN, true);
      
      const isCritical = alert.level === 'alarm' || alert.level === 'warning';
      if (isCritical) {
        playAlertSound(alert.level === 'alarm' ? 'alarm' : 'warning');
        setActiveAlert(alert);
      } else {
        showToast(alert.message || 'Cảnh báo mới', 'info');
      }
    });

    // 2. Lắng nghe cập nhật cảnh báo
    hub.on('AlertUpdated', () => {
      invalidateAlerts(ALERT_STATUS.OPEN);
      fetchAlerts(ALERT_STATUS.OPEN, true);
    });

    // 3. Lắng nghe sự kiện Camera AI
    hub.on('CameraEvent', (evt: any) => {
      // Chúng ta không gọi setActiveAlert ở đây nữa vì AlertNew sẽ hiển thị Popup 
      // với đầy đủ ảnh và thông tin chi tiết (do backend đã thống nhất gửi chung vào AlertNew)
      if (!evt || !evt.detectionType) return;
      const isCritical = ['fire', 'thermal_hotspot', 'intrusion'].includes(evt.detectionType);
      if (!isCritical) {
        showToast(`Camera: ${evt.detectionType.toUpperCase()}`, 'info');
      }
    });

    // 4. Lắng nghe cập nhật cảm biến (để đồng bộ store cho mọi tab)
    hub.on('SensorUpdate', (data: SensorPoint[]) => {
      if (!Array.isArray(data)) return;
      useSensorStore.setState(s => {
        const nextPoints = { ...s.pointsByStation };
        data.forEach(d => {
          // Lưu ý: data từ SignalR có thể không chứa stationId, chúng ta cập nhật vào mọi trạm có deviceId tương ứng
          Object.keys(nextPoints).forEach(sid => {
            const list = [...(nextPoints[sid] || [])];
            const idx = list.findIndex(p => p.pointId === d.pointId && p.deviceId === d.deviceId);
            if (idx >= 0) {
              list[idx] = d;
              nextPoints[sid] = list;
            }
          });
        });
        return { pointsByStation: nextPoints };
      });
    });

    hub.start().catch(err => console.warn('[AppShell] SignalR Global Error:', err));

    return () => {
      hub.stop();
    };
  }, [fetchAlerts, invalidateAlerts]);

  /** Chuyển mã vai trò (admin/manager/operator) thành nhãn tiếng Việt hiển thị trong sidebar. */
  const getRoleLabel = (role?: string) => {
    const r = (role || '').toLowerCase();
    if (r === 'admin') return 'QUẢN TRỊ';
    if (r === 'manager') return 'QUẢN LÝ';
    if (r === 'operator') return 'VẬN HÀNH';
    return '';
  };
  const [time, setTime] = useState(new Date().toLocaleTimeString('vi-VN'));
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showThemeList, setShowThemeList] = useState(false);
  const [popupPos, setPopupPos] = useState({ bottom: 0, left: 0 });
  const userMenuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);

  // Sidebar mở rộng mặc định; lưu preference vào localStorage
  const [expanded, setExpanded] = useState(
    () => localStorage.getItem('sidebar-expanded') !== 'false'
  );
  const [theme, setThemeState] = useState<string>(
    () => localStorage.getItem('station-theme') || 'industrial'
  );

  /** Áp dụng theme mới và lưu vào localStorage, hiển thị toast xác nhận. */
  const handleSelectTheme = (newTheme: string) => {
    setThemeState(newTheme);
    setGlobalTheme(newTheme as any);
    
    const themeNames: Record<string, string> = {
      dark: 'Tối Tiêu chuẩn',
      light: 'Trắng Tiêu chuẩn',
      'soft-light': 'Sáng Dịu mắt',
      silver: 'Bạc Tinh tế',
      industrial: 'Xám Công nghiệp',
      hightech: 'Xanh Hiện đại',
      cyberpunk: 'Tím Neon'
    };
    showToast(`Đã áp dụng giao diện ${themeNames[newTheme] || newTheme}`, 'success');
  };

  useEffect(() => {
    // Đóng user menu khi đổi route/tab
    setShowUserMenu(false);
    setShowThemeList(false);
  }, [location.pathname]);

  useEffect(() => {
    // Đóng user menu khi click ra ngoài
    const handleClickOutside = (event: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setShowUserMenu(false);
        setShowThemeList(false);
      }
    };

    if (showUserMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showUserMenu]);

  useEffect(() => {
    // Áp dụng theme đã lưu ngay khi shell mount
    const savedTheme = localStorage.getItem('station-theme') || 'industrial';
    document.documentElement.dataset.theme = savedTheme;
    document.documentElement.classList.remove('theme-blue', 'theme-dark', 'theme-light', 'theme-industrial', 'theme-hightech', 'theme-matrix', 'theme-cyberpunk', 'theme-retro');
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

  /** Chuyển đổi trạng thái sidebar (mở rộng/thu gọn) và lưu vào localStorage. */
  const toggle = () => {
    const next = !expanded;
    setExpanded(next);
    localStorage.setItem('sidebar-expanded', String(next));
  };

  /** Đăng xuất người dùng, xóa phiên và reload toàn bộ state app. */
  const handleLogout = () => {
    authService.logout();
    navigate('/login');
    window.location.reload(); // reset toàn bộ state app
  };

  /** Lọc và render danh sách NavLink theo vai trò người dùng, hỗ trợ sub-menu khi active. */
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
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center',
            width: 42, 
            height: 42, 
            borderRadius: '10px',
            background: '#1a1c1e', // matching industrial bg
            border: '1px solid rgba(255, 255, 255, 0.1)',
            boxShadow: 'inset 0 0 10px rgba(0,0,0,0.5), 0 0 15px rgba(16, 185, 129, 0.15)',
            flexShrink: 0
          }}>
            <img
              alt="StationOS"
              src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMDAgMTAwIj48ZGVmcz48bGluZWFyR3JhZGllbnQgaWQ9ImdyYWQiIHgxPSIwJSIgeTE9IjAlIiB4Mj0iMTAwJSIgeTI9IjEwMCUiPjxzdG9wIG9mZnNldD0iMCUiIHN0b3AtY29sb3I9IiM0NGZmODgiIC8+PHN0b3Agb2Zmc2V0PSIxMDAlIiBzdG9wLWNvbG9yPSIjMDI4NGM3IiAvPjwvbGluZWFyR3JhZGllbnQ+PGZpbHRlciBpZD0iZ2xvdyI+PGZlR2F1c3NpYW5CbHVyIHN0ZERldmlhdGlvbj0iMyIgcmVzdWx0PSJjb2xvcmVkQmx1ciIvPjxmZU1lcmdlPjxmZU1lcmdlTm9kZSBpbj0iY29sb3JlZEJsdXIiLz48ZmVNZXJnZU5vZGUgaW49IlNvdXJjZUdyYXBoaWMiLz48L2ZlTWVyZ2U+PC9maWx0ZXI+PC9kZWZzPjxjaXJjbGUgY3g9IjUwIiBjeT0iNTAiIHI9IjQ1IiBmaWxsPSJub25lIiBzdHJva2U9InVybCgjZ3JhZCkiIHN0cm9rZS13aWR0aD0iNiIgZmlsdGVyPSJ1cmwoI2dsb3cpIi8+PHBhdGggZD0iTTUwIDE1IEw4MCAzNSBMODAgNjUgTDUwIDg1IEwyMCA2NSBMMjAgMzUgWiIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjZmZmZmZmIiBzdHJva2Utd2lkdGg9IjMiIG9wYWNpdHk9IjAuNSIvPjxwYXRoIGQ9Ik01NSAyNSBMMzUgNTUgTDUwIDU1IEw0NSA3NSBMNjUgNDUgTDUwIDQ1IFoiIGZpbGw9IiM0NGZmODgiIGZpbHRlcj0idXJsKCNnbG93KSIvPjwvc3ZnPg=="
              style={{ width: 28, height: 28 }}
            />
          </div>
          <span style={{ 
            fontWeight: 700, 
            fontSize: '1rem', 
            color: 'var(--admin-text)', 
            opacity: 0.9,
            letterSpacing: '0.5px',
            fontFamily: 'var(--admin-font)',
            display: 'flex',
            alignItems: 'center'
          }}>
            HỆ THỐNG GIÁM SÁT 
            <span style={{ 
              color: 'var(--admin-accent)', 
              marginLeft: '12px',
              fontWeight: 900,
              fontSize: '1.1rem',
              letterSpacing: '1.5px',
              padding: '4px 16px',
              background: 'var(--admin-bg)',
              border: '1px solid var(--admin-border)',
              borderLeft: '4px solid var(--admin-accent)', // Industrial accent strip
              borderRadius: '4px',
              textShadow: '0 0 10px var(--admin-accent)',
              boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
              display: 'inline-block'
            }}>
              TRẠM ĐIỆN
            </span>
          </span>
          <span className="version-badge" style={{ 
            background: 'var(--admin-layer-2)', 
            color: 'var(--admin-text-muted)',
            padding: '3px 8px', 
            borderRadius: '4px', 
            fontSize: '0.65rem', 
            fontWeight: 600,
            border: '1px solid var(--admin-border-light)',
            marginLeft: '8px'
          }}>v{__APP_VERSION__}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
          <div className="header-clock">{time}</div>
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
              
              {/* Profile & User Menu Combined */}
              <div className="sb-user-action-wrap" style={{ position: 'relative' }} ref={userMenuRef}>
                
                {/* Popover Menu — position:fixed để thoát overflow:hidden của sidebar */}
                {showUserMenu && (
                  <div className="sb-user-popover" style={{ position: 'fixed', bottom: popupPos.bottom, left: popupPos.left, top: 'auto', width: 200, padding: '6px 0' }}>
                    <div 
                      className="sb-popover-item"
                      onClick={() => setShowThemeList(!showThemeList)}
                      style={{ justifyContent: 'space-between', fontWeight: 700, padding: '8px 12px' }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span>🎨 Giao diện:</span>
                        <span style={{ color: 'var(--admin-accent)' }}>{THEME_NAMES[theme] || theme}</span>
                      </div>
                      <span style={{ 
                        fontSize: '0.6rem', 
                        transform: showThemeList ? 'rotate(90deg)' : 'none', 
                        transition: 'transform 0.15s ease',
                        opacity: 0.5 
                      }}>▸</span>
                    </div>

                    {showThemeList && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 1, padding: '2px 6px', background: 'var(--admin-hover)', borderRadius: 4, margin: '2px 8px' }}>
                        {[
                          { value: 'dark', label: '⚫ Tối Tiêu chuẩn' },
                          { value: 'industrial', label: '🔘 Xám Công nghiệp' },
                          { value: 'hightech', label: '🔵 Xanh Hiện đại' },
                          { value: 'cyberpunk', label: '🟣 Tím Neon' },
                          { value: 'light', label: '⚪ Trắng Tiêu chuẩn' },
                          { value: 'soft-light', label: '🟡 Sáng Dịu mắt' },
                          { value: 'silver', label: '🥈 Bạc Tinh tế' },
                        ].map(t => {
                          const isActive = theme === t.value;
                          return (
                            <div
                              key={t.value}
                              onClick={() => handleSelectTheme(t.value)}
                              className="sb-popover-item"
                              style={{
                                fontWeight: isActive ? 800 : 500,
                                background: isActive ? 'var(--admin-accent)' : undefined,
                                color: isActive ? '#ffffff' : undefined,
                                justifyContent: 'space-between',
                                padding: '5px 8px',
                                fontSize: '0.7rem',
                                borderRadius: 3,
                              }}
                            >
                              <span>{t.label}</span>
                              {isActive && <span style={{ fontSize: '0.6rem' }}>✓</span>}
                            </div>
                          );
                        })}
                      </div>
                    )}
                    <div className="sb-popover-sep" style={{ margin: '4px 0' }} />
                    <div className="sb-popover-item danger" onClick={() => { setShowLogoutModal(true); setShowUserMenu(false); }} style={{ padding: '8px 12px' }}>
                      <LogOut size={14} strokeWidth={2} /> <span>Đăng xuất</span>
                    </div>
                  </div>
                )}

                <div
                  ref={triggerRef}
                  className={`sb-user-action ${showUserMenu ? 'active' : ''}`}
                  onClick={() => {
                    if (!showUserMenu && triggerRef.current) {
                      const r = triggerRef.current.getBoundingClientRect();
                      setPopupPos({ bottom: window.innerHeight - r.top + 6, left: r.left });
                    }
                    setShowUserMenu(v => !v);
                  }}
                  title={!expanded ? 'Tài khoản' : undefined}
                >
                  <div className="sb-profile">
                    <span className="user-avatar">{user.fullname?.[0] || 'N'}</span>
                    {expanded && (
                      <div className="sb-profile-info">
                        <div className="sb-profile-name">{user.fullname}</div>
                        {getRoleLabel(user.role) && <div className="sb-profile-role">{getRoleLabel(user.role)}</div>}
                      </div>
                    )}
                    {expanded && (
                      <ChevronRight 
                        size={14} 
                        strokeWidth={2.5} 
                        style={{ 
                          opacity: 0.4, 
                          transform: showUserMenu ? 'rotate(-90deg)' : 'none',
                          transition: 'transform 0.2s'
                        }} 
                      />
                    )}
                  </div>
                </div>
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

      {/* ── Rich Alert Modal ── */}
      {activeAlert && (
        <RichAlertModal 
          alert={activeAlert} 
          onClose={() => setActiveAlert(null)} 
        />
      )}

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
