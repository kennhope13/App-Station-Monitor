import './AnalyticsLayout.css';
import CabinetAnalyticsTab from './tabs/CabinetAnalyticsTab';

export default function AnalyticsLayout() {
  return (
    <div className="admin-page-container">
      <div className="page-toolbar-row">
        <div className="page-title-cell">
          <h2>PHÂN TÍCH</h2>
        </div>
        <div className="page-toolbar-group" />
      </div>

      {/* CONTENT */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <CabinetAnalyticsTab />
      </div>
    </div>
  );
}
