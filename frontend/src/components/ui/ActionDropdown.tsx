import React, { useState, useRef, useEffect } from 'react';
import { Edit2 } from 'lucide-react';

interface ActionDropdownProps {
  children: React.ReactNode;
}

export default function ActionDropdown({ children }: ActionDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  return (
    <div className="action-dropdown-wrap" style={{ position: 'relative', display: 'inline-block' }} ref={menuRef}>
      <button 
        className="btn-industrial btn-sm" 
        style={{ 
          width: 30, height: 24, padding: 0, 
          background: 'transparent', border: '1px solid var(--admin-border)',
          borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'var(--admin-text-muted)'
        }} 
        onClick={(e) => { e.stopPropagation(); setIsOpen(!isOpen); }}
        title="Thao tác"
      >
        <Edit2 size={16} />
      </button>

      {isOpen && (
        <div 
          className="action-dropdown-list" 
          style={{ 
            position: 'fixed', 
            top: menuRef.current?.getBoundingClientRect().bottom ? menuRef.current.getBoundingClientRect().bottom + 4 : 0,
            left: menuRef.current?.getBoundingClientRect().right ? menuRef.current.getBoundingClientRect().right - 140 : 0,
            background: 'var(--admin-panel)',
            border: '1px solid var(--admin-border)',
            borderRadius: 6,
            boxShadow: '0 10px 25px rgba(0, 0, 0, 0.4)',
            zIndex: 9999,
            minWidth: 140,
            padding: 4,
            display: 'flex',
            flexDirection: 'column',
            animation: 'dropdownFadeIn 0.15s ease-out'
          }}
          onClick={(e) => {
            e.stopPropagation();
            setIsOpen(false); // Đóng menu sau khi chọn một chức năng
          }}
        >
          {children}
        </div>
      )}

      <style>{`
        @keyframes dropdownFadeIn {
          from { opacity: 0; transform: translateY(-10px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

interface ActionDropdownItemProps {
  icon?: React.ReactNode;
  label: string;
  onClick: (e: React.MouseEvent) => void;
  danger?: boolean;
}

export function ActionDropdownItem({ icon, label, onClick, danger }: ActionDropdownItemProps) {
  return (
    <button 
      className={`dropdown-item ${danger ? 'danger' : ''}`} 
      style={{ 
        display: 'flex', alignItems: 'center', gap: icon ? 10 : 0,
        padding: '8px 12px', border: 'none', background: 'transparent',
        width: '100%', textAlign: 'left', cursor: 'pointer',
        fontSize: '0.78rem', fontWeight: 600, borderRadius: 4,
        color: danger ? 'var(--admin-danger)' : 'var(--admin-text)',
        transition: 'background 0.15s'
      }} 
      onClick={(e) => { 
        console.log(`ActionDropdownItem clicked: ${label}`);
        onClick(e); 
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = danger ? 'rgba(239,68,68,0.1)' : 'var(--admin-hover)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
    >
      {icon && <span style={{ display: 'flex', opacity: 0.7 }}>{icon}</span>}
      <span>{label}</span>
    </button>
  );
}
