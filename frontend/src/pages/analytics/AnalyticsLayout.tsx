import { useState } from 'react';
import './AnalyticsLayout.css';
import CabinetAnalyticsTab from './tabs/CabinetAnalyticsTab';
import ThermalForecastTab from './tabs/ThermalForecastTab';
import PdAnalyticsTab from './tabs/PdAnalyticsTab';
import CentralAnalyticsLayout from './CentralAnalyticsLayout';
import { authService } from '@/services/AuthService';
import { isCentralDrillDown, isCentralUser } from '@/utils/centralAccess';

/**
 * Layout trang Phân tích: bao bọc nội dung phân tích tủ điện, nhiệt độ và phóng điện.
 */
export default function AnalyticsLayout() {
  const currentUser = authService.getUser();
  const showCentralAnalytics = isCentralUser(currentUser) && !isCentralDrillDown(currentUser);
  const [activeTab, setActiveTab] = useState<'cabinet' | 'thermal' | 'pd'>('thermal');

  if (showCentralAnalytics) {
    return <CentralAnalyticsLayout />;
  }

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
            <button
              onClick={() => setActiveTab('cabinet')}
              className={`btn-industrial ${activeTab === 'cabinet' ? 'btn-primary' : ''}`}
            >
              PHÂN TÍCH TỦ ĐIỆN
            </button>
          </div>
        </div>
      </div>

      <div className="analytics-content-area" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {activeTab === 'cabinet' && <CabinetAnalyticsTab />}
        {activeTab === 'thermal' && <ThermalForecastTab />}
        {activeTab === 'pd' && <PdAnalyticsTab />}
      </div>
    </div>
  );
}
