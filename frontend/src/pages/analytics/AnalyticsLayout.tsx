import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import './AnalyticsLayout.css';
import CabinetAnalyticsTab from './tabs/CabinetAnalyticsTab';
import ThermalForecastTab from './tabs/ThermalForecastTab';
import PdAnalyticsTab from './tabs/PdAnalyticsTab';
import CentralAnalyticsLayout from './CentralAnalyticsLayout';
import { authService } from '@/services/AuthService';
import { isCentralDrillDown, isCentralUser } from '@/utils/centralAccess';
import { Activity, Thermometer, Zap } from 'lucide-react';

/**
 * Layout trang Phân tích: bao bọc nội dung phân tích tủ điện, nhiệt độ và phóng điện.
 */
export default function AnalyticsLayout() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = (searchParams.get('tab') as 'cabinet' | 'thermal' | 'pd') || 'thermal';

  const setActiveTab = (tab: 'cabinet' | 'thermal' | 'pd') => {
    setSearchParams(prev => {
      prev.set('tab', tab);
      return prev;
    }, { replace: true });
  };

  const currentUser = authService.getUser();
  const showCentralAnalytics = !!currentUser && isCentralUser(currentUser) && !isCentralDrillDown();
  const tabs = useMemo(() => ([
    {
      id: 'thermal' as const,
      label: 'AI Nhiệt',
      title: 'Dự báo nhiệt',
      desc: 'Theo dõi điểm nóng, dự báo xu hướng và camera nhiệt.',
      icon: <Thermometer size={15} />
    },
    {
      id: 'pd' as const,
      label: 'Phóng điện',
      title: 'PD Analytics',
      desc: 'Giám sát cường độ, sự kiện và vùng phóng điện cục bộ.',
      icon: <Zap size={15} />
    },
    {
      id: 'cabinet' as const,
      label: 'Tủ điện',
      title: 'Cabinet Health',
      desc: 'Đánh giá sức khỏe thiết bị, cảnh báo và hành vi vận hành.',
      icon: <Activity size={15} />
    }
  ]), []);
  const activeTabMeta = tabs.find(tab => tab.id === activeTab) ?? tabs[0];

  if (showCentralAnalytics) {
    return <CentralAnalyticsLayout />;
  }

  return (
    <div className="admin-page-container analytics-shell">
      <section className="analytics-hero">
        <div className="analytics-hero-copy">
          <span className="analytics-eyebrow">Station Intelligence</span>
          <h2>PHÂN TÍCH</h2>
          <p>{activeTabMeta.desc}</p>
        </div>
        <div className="analytics-hero-status">
          <span className="analytics-status-label">Chế độ</span>
          <strong>{activeTabMeta.title}</strong>
        </div>
      </section>

      <div className="analytics-tab-strip">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`analytics-tab-card${activeTab === tab.id ? ' is-active' : ''}`}
            type="button"
          >
            <span className="analytics-tab-icon">{tab.icon}</span>
            <span className="analytics-tab-text">
              <strong>{tab.label}</strong>
              <small>{tab.title}</small>
            </span>
          </button>
        ))}
      </div>

      <div className="analytics-content-area analytics-content-surface" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {activeTab === 'cabinet' && <CabinetAnalyticsTab />}
        {activeTab === 'thermal' && <ThermalForecastTab />}
        {activeTab === 'pd' && <PdAnalyticsTab />}
      </div>
    </div>
  );
}
