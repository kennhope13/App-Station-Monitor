import { useState } from 'react';
import './AnalyticsLayout.css';
import CabinetAnalyticsTab from './tabs/CabinetAnalyticsTab';
import ThermalForecastTab from './tabs/ThermalForecastTab';
import PdAnalyticsTab from './tabs/PdAnalyticsTab';

/**
 * Layout trang Phân tích: bao bọc nội dung phân tích tủ điện, nhiệt độ và phóng điện.
 */
export default function AnalyticsLayout() {
  const [activeTab, setActiveTab] = useState<'cabinet' | 'thermal' | 'pd'>('cabinet');

  return (
    <div className="admin-page-container">
      <div className="page-toolbar-row">
        <div className="page-title-cell">
          <h2>PHÂN TÍCH</h2>
        </div>

        <div className="page-toolbar-group">
          {/* TAB SELECTOR */}
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={() => setActiveTab('cabinet')}
              className={`btn-industrial ${activeTab === 'cabinet' ? 'btn-primary' : ''}`}
            >
              PHÂN TÍCH TỦ ĐIỆN
            </button>
            <button
              onClick={() => setActiveTab('thermal')}
              className={`btn-industrial ${activeTab === 'thermal' ? 'btn-primary' : ''}`}
            >
              AI NHIỆT
            </button>
            <button
              onClick={() => setActiveTab('pd')}
              className={`btn-industrial ${activeTab === 'pd' ? 'btn-primary' : ''}`}
            >
              PHÂN TÍCH PHÓNG ĐIỆN
            </button>
          </div>
        </div>
      </div>

      {/* CONTENT */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {activeTab === 'cabinet' && <CabinetAnalyticsTab />}
        {activeTab === 'thermal' && <ThermalForecastTab />}
        {activeTab === 'pd' && <PdAnalyticsTab />}
      </div>
    </div>
  );
}
