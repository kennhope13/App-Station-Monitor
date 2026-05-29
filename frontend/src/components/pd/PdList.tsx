// src/components/pd/PdList.tsx
import React from 'react';
import { Boundary } from '@/services/pdApi';

type Props = {
  regions: Boundary[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onEdit: (region: Boundary) => void;
  onDelete: (id: string) => void;
};

export const PdList: React.FC<Props> = ({ regions, activeId, onSelect, onEdit, onDelete }) => {
  return (
    <div className="admin-card" style={{ width: 250, flexShrink: 0, padding: 0, overflow: 'auto' }}>
      <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--admin-border)', fontSize: '.65rem', fontWeight: 800, color: 'var(--admin-text-muted)', textTransform: 'uppercase', letterSpacing: '.8px' }}>
        Vùng PD ({regions.length})
      </div>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {regions.length === 0 ? (
          <div style={{ padding: 16, fontSize: '.78rem', color: 'var(--admin-text-muted)', textAlign: 'center' }}>Chưa có vùng PD.</div>
        ) : (
          regions.map(r => (
            <div
              key={r.id}
              onClick={() => onSelect(r.id)}
              style={{
                padding: '10px 14px',
                cursor: 'pointer',
                borderBottom: '1px solid var(--admin-border)',
                background: activeId === r.id ? 'rgba(59,130,246,.08)' : 'transparent',
                borderLeft: activeId === r.id ? '3px solid var(--admin-accent)' : '3px solid transparent',
                transition: '.12s',
              }}
            >
              <div style={{ fontWeight: 700, fontSize: '.8rem', color: 'var(--admin-text)' }}>{r.name}</div>
              <div style={{ fontSize: '.68rem', color: 'var(--admin-text-muted)', marginTop: 2 }}>
                Cảnh báo: {r.warningThreshold ?? 20} dB | Cảnh báo cấp cao: {r.alarmThreshold ?? 45} dB
              </div>
              <div style={{ marginTop: 4, display: 'flex', gap: 4 }}>
                <button className="btn-industrial btn-sm" onClick={e => { e.stopPropagation(); onEdit(r); }}>Sửa</button>
                <button className="btn-industrial btn-sm btn-danger" onClick={e => { e.stopPropagation(); onDelete(r.id); }}>Xóa</button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
