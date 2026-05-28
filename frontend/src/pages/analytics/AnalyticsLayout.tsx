import './AnalyticsLayout.css';
import CabinetAnalyticsTab from './tabs/CabinetAnalyticsTab';

export default function AnalyticsLayout() {
  return (
    <div className="alerts-history-page" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* TOOLBAR */}
      <div className="page-toolbar-row" style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <div className="page-title-cell">
          <h2>PHÂN TÍCH HỆ THỐNG</h2>
        </div>
      </div>

      {/* CONTENT */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <CabinetAnalyticsTab />
      </div>
    </div>
  );
}
