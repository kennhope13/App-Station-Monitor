// ============================================================
// ReportsPage.tsx — Báo cáo dữ liệu
// Tab "Xuất XLSX": chọn cảm biến + khoảng thời gian → xem trước + xuất file
// Tab "Báo cáo": tạo báo cáo định kỳ (daily/monthly/event), tải về PDF
// ============================================================

import { useState, useEffect } from 'react';
import { stationApi, AlertItem } from '@/services/StationApiService';
import { TabId } from './types';
import ExportTab from './tabs/ExportTab';
import ReportTab from './tabs/ReportTab';

export default function ReportsPage() {
  const [activeTab, setActiveTab] = useState<TabId>('export');
  const [stationId, setStationId] = useState('');
  const [alerts, setAlerts] = useState<AlertItem[]>([]);

  useEffect(() => {
    stationApi.getStations().then(st => {
      if (st[0]) setStationId(st[0].id);
    }).catch(() => {});
    stationApi.getAlerts(undefined, undefined, undefined, 500).then(setAlerts).catch(() => {});
  }, []);

  return (
    <div className="alerts-history-page" style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: 8, background: 'var(--admin-bg)', boxSizing: 'border-box', gap: 8 }}>
      {/* TOOLBAR & TAB BAR */}
      <div className="page-toolbar-row">
        <div className="page-title-cell">
          <h2>BÁO CÁO HỆ THỐNG</h2>
        </div>
        <div className="page-toolbar-group">
          <button onClick={() => setActiveTab('export')} className={`btn-industrial${activeTab === 'export' ? ' btn-primary' : ''}`} style={{ height: 34, padding: '0 16px', fontSize: '.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px' }}>
            Xuất dữ liệu
          </button>
          <button onClick={() => setActiveTab('report')} className={`btn-industrial${activeTab === 'report' ? ' btn-primary' : ''}`} style={{ height: 34, padding: '0 16px', fontSize: '.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px' }}>
            Báo cáo phân tích
          </button>
        </div>
      </div>
 
      {/* CONTENT */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {activeTab === 'export' && <ExportTab stationId={stationId} alerts={alerts} />}
        {activeTab === 'report' && <ReportTab stationId={stationId} />}
      </div>
    </div>
  );
}
