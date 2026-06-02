import { useNavigate } from 'react-router-dom';
import { AlertTriangle, X, Image as ImageIcon } from 'lucide-react';
import type { AlertItem } from '@/types/api.types';
import { API_BASE_URL } from '@/utils/env';

interface RichAlertModalProps {
  alert: AlertItem;
  onClose: () => void;
}

export default function RichAlertModal({ alert, onClose }: RichAlertModalProps) {
  const navigate = useNavigate();
  
  const isAlarm = alert.level === 'alarm';
  const color = isAlarm ? 'var(--admin-danger)' : 'var(--admin-warning)';
  const shadowColor = isAlarm ? 'rgba(239, 68, 68, 0.3)' : 'rgba(245, 158, 11, 0.3)';
  const headerText = isAlarm ? 'BÁO ĐỘNG MỚI' : 'CẢNH BÁO MỚI';

  // Parse metadata
  let meta: any = {};
  if (typeof alert.metadata === 'string') {
    try { meta = JSON.parse(alert.metadata); } catch {}
  } else if (alert.metadata) {
    meta = alert.metadata;
  }

  // Xử lý URL ảnh
  let rawUrl = alert.thumbnailUrl || alert.imageUrl || meta.snapshotUrl || meta.thumbnailUrl;
  const imageUrl = rawUrl
    ? (rawUrl.startsWith('http') || rawUrl.startsWith('blob:') || rawUrl.startsWith('data:') ? rawUrl : `${API_BASE_URL}${rawUrl}`)
    : null;

  const handleContainerClick = () => {
    navigate(`/alerts-history?alertId=${alert.id}`);
    onClose();
  };

  return (
    <div 
      style={{ 
        position: 'fixed', top: 80, right: 20, zIndex: 100005,
        width: 380, background: 'var(--admin-bg)',
        border: `2px solid ${color}`, 
        boxShadow: `0 10px 40px rgba(0, 0, 0, 0.6), 0 0 20px ${shadowColor}`,
        borderRadius: 8, overflow: 'hidden',
        cursor: 'pointer',
        animation: 'sideAlertIn 0.5s cubic-bezier(0.16, 1, 0.3, 1)'
      }}
      onClick={handleContainerClick}
    >
      {/* Header báo động */}
      <div style={{ 
        background: color, 
        color: '#fff', padding: '10px 16px', 
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <AlertTriangle size={18} fill="#fff" color={color} />
          <span style={{ fontWeight: 900, fontSize: '0.85rem', letterSpacing: 1 }}>{headerText}</span>
        </div>
        <button 
          onClick={(e) => { e.stopPropagation(); onClose(); }} 
          style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', opacity: 0.6 }}
        >
          <X size={18} />
        </button>
      </div>
      
      <div style={{ padding: 16, display: 'flex', gap: 16 }}>
        {/* Vùng hiển thị ảnh snapshot nhỏ */}
        <div style={{ 
          width: 120, height: 90, borderRadius: 4, overflow: 'hidden', 
          border: '1px solid var(--admin-border)', background: '#000', 
          flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}>
          {imageUrl ? (
            <img src={imageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <ImageIcon size={24} style={{ opacity: 0.2 }} />
          )}
        </div>

        {/* Chi tiết cảnh báo */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '0.65rem', color: 'var(--admin-text-muted)', marginBottom: 4 }}>
            {new Date(alert.triggeredAt).toLocaleTimeString('vi-VN')}
          </div>
          <div style={{ 
            fontSize: '0.85rem', fontWeight: 800, color: 'var(--admin-text)', 
            lineHeight: 1.3, marginBottom: 8,
            display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden'
          }}>
            {alert.message}
          </div>
          <div style={{ fontSize: '0.7rem', color: 'var(--admin-accent)', fontWeight: 700 }}>
            Nhấn để xem chi tiết →
          </div>
        </div>
      </div>
      
      <style>{`
        @keyframes sideAlertIn {
          from { opacity: 0; transform: translateX(100%) scale(0.9); }
          to { opacity: 1; transform: translateX(0) scale(1); }
        }
      `}</style>
    </div>
  );
}
