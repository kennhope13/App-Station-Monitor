import { useState } from 'react';
import { AnalyticsData } from '../types';

export default function CabinetDiagnosticsTab({ }: { data: AnalyticsData }) {
  const [selectedNode, setSelectedNode] = useState<string>('cabinet-01');

  return (
    <div style={{ display: 'flex', gap: 12, height: '100%', overflow: 'hidden' }}>
      {/* Left Sidebar: Device Tree */}
      <div style={{ width: 260, background: 'var(--admin-panel)', border: '1px solid var(--admin-border)', borderRadius: 8, padding: 12, display: 'flex', flexDirection: 'column' }}>
        <h3 style={{ margin: '0 0 12px 0', fontSize: '0.75rem', fontWeight: 700, color: 'var(--admin-text-muted)', textTransform: 'uppercase' }}>Danh sách thiết bị</h3>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {/* Mock Tree */}
          <div style={{ fontSize: '0.8rem', color: 'var(--admin-text)', marginBottom: 8 }}>Trạm 110kV</div>
          <div style={{ marginLeft: 16 }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--admin-text-muted)', marginBottom: 4 }}>Trong nhà</div>
            <div style={{ marginLeft: 16, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {['Tủ 01 - Lộ Tổng', 'Tủ 02 - Đo Lường', 'Tủ 03 - MBA', 'Tủ 04 - Tụ Bù'].map((c, i) => {
                const id = `cabinet-0${i + 1}`;
                return (
                  <div 
                    key={id}
                    onClick={() => setSelectedNode(id)}
                    style={{ 
                      padding: '4px 8px', borderRadius: 4, cursor: 'pointer',
                      background: selectedNode === id ? 'rgba(59,130,246,0.1)' : 'transparent',
                      color: selectedNode === id ? 'var(--admin-btn-secondary-text)' : 'var(--admin-text-muted)',
                      borderLeft: selectedNode === id ? '2px solid var(--admin-accent)' : '2px solid transparent'
                    }}
                  >
                    ️ {c}
                  </div>
                );
              })}
            </div>
          </div>
          <div style={{ marginLeft: 16, marginTop: 12 }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--admin-text-muted)', marginBottom: 4 }}>Ngoài trời</div>
            <div style={{ marginLeft: 16, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {['Camera Nhiệt T1', 'Camera Nhiệt DCL 171'].map((c, i) => {
                const id = `cam-0${i + 1}`;
                return (
                  <div 
                    key={id}
                    onClick={() => setSelectedNode(id)}
                    style={{ 
                      padding: '4px 8px', borderRadius: 4, cursor: 'pointer',
                      background: selectedNode === id ? 'rgba(59,130,246,0.1)' : 'transparent',
                      color: selectedNode === id ? 'var(--admin-btn-secondary-text)' : 'var(--admin-text-muted)',
                      borderLeft: selectedNode === id ? '2px solid var(--admin-accent)' : '2px solid transparent'
                    }}
                  >
                    {c}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Center & Right Content */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12, overflow: 'hidden' }}>
        <div style={{ flex: 1, background: 'var(--admin-panel)', border: '1px solid var(--admin-border)', borderRadius: 8, padding: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--admin-text-muted)' }}>
          {selectedNode.startsWith('cabinet') ? 'Sơ đồ mặt cắt tủ điện & Thông số cảm biến' : 'Luồng video Camera nhiệt & Điểm đo'}
        </div>
        <div style={{ height: 200, background: 'var(--admin-panel)', border: '1px solid var(--admin-border)', borderRadius: 8, padding: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--admin-text-muted)', flexShrink: 0 }}>
          Đồ thị xu hướng 24h
        </div>
      </div>
    </div>
  );
}
