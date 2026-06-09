// ============================================================
// ReportsPage.tsx — Báo cáo dữ liệu
// Tab "Xuất XLSX": chọn cảm biến + khoảng thời gian → xem trước + xuất file
// Tab "Báo cáo": tạo báo cáo định kỳ (daily/monthly/event), tải về PDF
// ============================================================

import { useState, useEffect } from 'react';
import ToolbarSelect from '@/components/ui/ToolbarSelect';
import { stationApi, AlertItem } from '@/services/StationApiService';
import { useStationStore } from '@/store';
import { TabId } from './types';
import ExportTab from './tabs/ExportTab';
import ReportTab from './tabs/ReportTab';

interface ReportsPageProps {
  embeddedMode?: 'default' | 'central';
}

export default function ReportsPage({ embeddedMode = 'default' }: ReportsPageProps) {
  const [activeTab, setActiveTab] = useState<TabId>('export');
  const [stationId, setStationId] = useState('');
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const stations = useStationStore(s => s.stations);
  const fetchStations = useStationStore(s => s.fetch);

  useEffect(() => {
    fetchStations().then(() => {
      // Mặc định chọn "Tất cả các trạm" (stationId = '')
    }).catch(() => {});
    stationApi.getAlerts(undefined, undefined, undefined, 500).then(setAlerts).catch(() => {});
  }, [fetchStations]);

  return (
    <div className="admin-page-container">
      {/* TOOLBAR & TAB BAR */}
      <div className="page-toolbar-row">
        <div className="page-title-cell">
          {embeddedMode !== 'central' && <h2>BÁO CÁO</h2>}
        </div>
        <div className="page-toolbar-group">
          <div className="page-toolbar-cell" style={{ height: 28 }}>
            <span className="page-cell-label">TRẠM:</span>
            <ToolbarSelect
              value={stationId}
              onChange={setStationId}
              options={[{ value: '', label: 'Tất cả các trạm' }, ...stations.map(s => ({ value: s.id, label: s.name }))]}
              width={160}
            />
          </div>
          <button 
            onClick={() => setActiveTab('export')} 
            className={`btn-industrial ${activeTab === 'export' ? 'btn-primary' : ''}`} 
          >
            Xuất dữ liệu
          </button>
          <button 
            onClick={() => setActiveTab('report')} 
            className={`btn-industrial ${activeTab === 'report' ? 'btn-primary' : ''}`} 
          >
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
