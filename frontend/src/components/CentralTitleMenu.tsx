import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, Map, FileArchive, FileText, Users, LogOut } from 'lucide-react';
import { authService } from '@/services/AuthService';
import { isCentralUser } from '@/utils/centralAccess';

interface Props {
  title: string;
}

export default function CentralTitleMenu({ title }: Props) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const currentUser = authService.getUser();
  const isCentralMode = isCentralUser(currentUser);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        triggerRef.current && !triggerRef.current.contains(e.target as Node) &&
        menuRef.current && !menuRef.current.contains(e.target as Node)
      ) setOpen(false);
    };
    if (open) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  if (!isCentralMode) return <h2>{title}</h2>;

  const handleOpen = () => {
    if (!open && triggerRef.current) {
      const r = triggerRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 4, left: r.left });
    }
    setOpen(v => !v);
  };

  const go = (path: string) => { navigate(path); setOpen(false); };

  return (
    <>
      <div
        ref={triggerRef}
        onClick={handleOpen}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', userSelect: 'none' }}
      >
        <h2 style={{ margin: 0 }}>{title}</h2>
        <ChevronDown
          size={13}
          strokeWidth={2.5}
          style={{ color: 'var(--admin-text-muted)', flexShrink: 0, transition: 'transform 0.15s', transform: open ? 'rotate(180deg)' : 'none' }}
        />
      </div>
      {open && (
        <div
          ref={menuRef}
          style={{ position: 'fixed', top: pos.top, left: pos.left, width: 220, background: 'var(--admin-panel)', border: '1px solid var(--admin-border)', boxShadow: '0 10px 30px rgba(0,0,0,0.5)', borderRadius: 4, zIndex: 9999, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
        >
          <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--admin-border-light)', background: 'var(--admin-layer-2)', fontSize: '0.65rem', fontWeight: 800, color: 'var(--admin-text-muted)' }}>
            QUẢN TRỊ TỔNG QUAN
          </div>
          <div style={{ padding: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <button onClick={() => go('/multisite')} className="sb-popover-item" style={{ width: '100%', textAlign: 'left', padding: '6px 8px', fontSize: '0.7rem', display: 'flex', alignItems: 'center', gap: 8, background: 'transparent', border: 'none', color: 'var(--admin-text)', cursor: 'pointer', borderRadius: 2 }}>
              <Map size={14} /> Bản đồ tổng quan
            </button>
            <button onClick={() => go('/audit-log')} className="sb-popover-item" style={{ width: '100%', textAlign: 'left', padding: '6px 8px', fontSize: '0.7rem', display: 'flex', alignItems: 'center', gap: 8, background: 'transparent', border: 'none', color: 'var(--admin-text)', cursor: 'pointer', borderRadius: 2 }}>
              <FileArchive size={14} /> Nhật ký hệ thống
            </button>
            <button onClick={() => go('/reports')} className="sb-popover-item" style={{ width: '100%', textAlign: 'left', padding: '6px 8px', fontSize: '0.7rem', display: 'flex', alignItems: 'center', gap: 8, background: 'transparent', border: 'none', color: 'var(--admin-text)', cursor: 'pointer', borderRadius: 2 }}>
              <FileText size={14} /> Báo cáo
            </button>
            <button onClick={() => go('/user-management')} className="sb-popover-item" style={{ width: '100%', textAlign: 'left', padding: '6px 8px', fontSize: '0.7rem', display: 'flex', alignItems: 'center', gap: 8, background: 'transparent', border: 'none', color: 'var(--admin-text)', cursor: 'pointer', borderRadius: 2 }}>
              <Users size={14} /> Quản lý người dùng
            </button>
          </div>
          <div style={{ borderTop: '1px solid var(--admin-border-light)', padding: 4 }}>
            <button
              onClick={() => { authService.logout(); navigate('/login'); window.location.reload(); }}
              className="sb-popover-item danger"
              style={{ width: '100%', textAlign: 'left', padding: '8px', fontSize: '0.7rem', display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(239,68,68,0.1)', border: 'none', color: 'var(--admin-danger)', cursor: 'pointer', borderRadius: 2, fontWeight: 700 }}
            >
              <LogOut size={14} /> Đăng xuất
            </button>
          </div>
        </div>
      )}
    </>
  );
}
