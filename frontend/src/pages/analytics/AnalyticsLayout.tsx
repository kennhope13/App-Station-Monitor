import './AnalyticsLayout.css';
import CabinetAnalyticsTab from './tabs/CabinetAnalyticsTab';

export default function AnalyticsLayout() {
  return (
    <div className="alerts-history-page" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* TOOLBAR */}
      <div className="ah-toolbar-container">
        <div className="ah-toolbar-cell title-cell">
          <h2 style={{ margin: 0, fontSize: '.85rem', fontWeight: 800, letterSpacing: '0.5px', textTransform: 'uppercase', fontFamily: 'Consolas,monospace', color: 'var(--admin-text)' }}>
            PHÂN TÍCH
          </h2>
        </div>
      </div>

      {/* CONTENT */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <CabinetAnalyticsTab />
      </div>
    </div>
  );
}
