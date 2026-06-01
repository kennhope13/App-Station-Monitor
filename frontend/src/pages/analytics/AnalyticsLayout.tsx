import { useState } from 'react';
import './AnalyticsLayout.css';
import CabinetAnalyticsTab from './tabs/CabinetAnalyticsTab';
import ThermalForecastTab from './tabs/ThermalForecastTab';

/**
 * Layout trang Phân tích: bao bọc nội dung phân tích tủ điện,
 * hiển thị tiêu đề toolbar và render tab CabinetAnalyticsTab bên dưới.
 */
export default function AnalyticsLayout() {
  const [activeTab, setActiveTab] = useState<'cabinet' | 'thermal'>('cabinet');

  return (
    <div className="admin-page-container">
      <div className="page-toolbar-row">
        <div className="page-title-cell" style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
          <h2>PHÂN TÍCH</h2>

          {/* TAB SELECTOR */}
          <div style={{ display: 'flex', gap: 6, background: 'var(--admin-layer-1)', padding: 3, borderRadius: 6, border: '1px solid var(--admin-border)' }}>
            <button
              onClick={() => setActiveTab('cabinet')}
              style={{
                background: activeTab === 'cabinet' ? 'var(--admin-accent)' : 'transparent',
                color: activeTab === 'cabinet' ? '#fff' : 'var(--admin-text-muted)',
                border: 'none',
                padding: '6px 16px',
                borderRadius: 4,
                fontSize: '.72rem',
                fontWeight: 700,
                cursor: 'pointer',
                fontFamily: 'Consolas, monospace',
                transition: 'all 0.15s ease'
              }}
            >
              PHÂN TÍCH TỦ ĐIỆN
            </button>
            <button
              onClick={() => setActiveTab('thermal')}
              style={{
                background: activeTab === 'thermal' ? 'var(--admin-accent)' : 'transparent',
                color: activeTab === 'thermal' ? '#fff' : 'var(--admin-text-muted)',
                border: 'none',
                padding: '6px 16px',
                borderRadius: 4,
                fontSize: '.72rem',
                fontWeight: 700,
                cursor: 'pointer',
                fontFamily: 'Consolas, monospace',
                transition: 'all 0.15s ease'
              }}
            >
              GIÁM SÁT & DỰ BÁO NHIỆT AI
            </button>
          </div>
        </div>
        <div className="page-toolbar-group" />
      </div>

      {/* CONTENT */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        {activeTab === 'cabinet' ? <CabinetAnalyticsTab /> : <ThermalForecastTab />}
      </div>
    </div>
  );
}
