import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Activity, AlertTriangle, Radio, Thermometer, Wifi, Zap } from 'lucide-react';
import {
  stationApi,
  type AlertItem,
  type Device,
  type HealthScore,
  type SensorPoint,
  type Station,
} from '@/services/StationApiService';
import { useStationStore } from '@/store';
import { MULTISITE_RETURN_TAB_KEY } from '@/utils/centralAccess';

type CentralTab = 'overview' | 'thermal' | 'pd' | 'health';

interface StationAnalyticsSnapshot {
  station: Station;
  devices: Device[];
  points: SensorPoint[];
  healthScores: HealthScore[];
  avgHealth: number | null;
  onlineDevices: number;
  openAlerts: number;
  warningPdPoints: number;
  hottestPoint: { value: number; label: string } | null;
}

const isThermalPoint = (point: SensorPoint) =>
  point.unit?.includes('C') || /nhiet|temp|thermal/i.test(point.pointId || '');

const isPdPoint = (point: SensorPoint) => /pd|phong_dien/i.test(point.pointId || '');

const getHealthClass = (score: number | null) => {
  if (score == null) return { label: 'Chưa đủ dữ liệu', color: 'var(--admin-text-muted)' };
  if (score < 50) return { label: 'Nguy cơ cao', color: 'var(--admin-danger)' };
  if (score < 75) return { label: 'Cần theo dõi', color: '#f59e0b' };
  return { label: 'Ổn định', color: '#10b981' };
};

const getThermalClass = (value: number | null) => {
  if (value == null) return { label: 'Không có dữ liệu', color: 'var(--admin-text-muted)' };
  if (value >= 80) return { label: 'Điểm nóng nguy hiểm', color: 'var(--admin-danger)' };
  if (value >= 60) return { label: 'Nóng bất thường', color: '#f59e0b' };
  return { label: 'Bình thường', color: '#10b981' };
};

const getPdClass = (count: number) => {
  if (count >= 3) return { label: 'PD đáng lo', color: 'var(--admin-danger)' };
  if (count >= 1) return { label: 'Có dấu hiệu PD', color: '#f59e0b' };
  return { label: 'Ổn định', color: '#10b981' };
};

function MetricCard({ label, value, sub, icon, accentColor }: { label: string; value: string | number; sub: string; icon: React.ReactNode; accentColor?: string }) {
  return (
    <div className="admin-card" style={{ padding: 16, borderLeft: accentColor ? `4px solid ${accentColor}` : undefined }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ width: 40, height: 40, borderRadius: 10, background: accentColor ? `${accentColor}1A` : 'var(--admin-layer-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: accentColor || 'var(--admin-text-muted)' }}>
          {icon}
        </div>
        <div>
          <div style={{ fontSize: '.65rem', color: 'var(--admin-text-muted)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
          <div style={{ fontSize: '1.4rem', fontWeight: 900, color: 'var(--admin-text)', marginTop: 2, lineHeight: 1.1 }}>{value}</div>
        </div>
      </div>
      <div style={{ marginTop: 12, fontSize: '.7rem', color: 'var(--admin-text-muted)', fontWeight: 600 }}>{sub}</div>
    </div>
  );
}

export default function CentralAnalyticsLayout() {
  const navigate = useNavigate();
  const setViewingStation = useStationStore(s => s.setViewingStation);

  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<CentralTab>('overview');
  const [stations, setStations] = useState<StationAnalyticsSnapshot[]>([]);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const [stationList, recentAlerts] = await Promise.all([
          stationApi.getStations(),
          stationApi.getAlerts(undefined, undefined, undefined, 60),
        ]);

        const snapshots = await Promise.all(
          stationList.map(async (station) => {
            const [devices, points, healthScores] = await Promise.all([
              stationApi.getDevices(station.id).catch(() => [] as Device[]),
              stationApi.getLatestPoints(station.id).catch(() => [] as SensorPoint[]),
              stationApi.getHealthScores(station.id).catch(() => [] as HealthScore[]),
            ]);

            const healthValues = healthScores
              .map(item => item.score)
              .filter((value): value is number => Number.isFinite(value));
            const avgHealth = healthValues.length > 0
              ? healthValues.reduce((sum, value) => sum + value, 0) / healthValues.length
              : null;

            const hottest = points
              .filter(isThermalPoint)
              .reduce<{ value: number; label: string } | null>((max, point) => {
                if (typeof point.value !== 'number') return max;
                if (!max || point.value > max.value) {
                  return { value: point.value, label: point.pointId };
                }
                return max;
              }, null);

            const stationAlerts = recentAlerts.filter(alert => alert.stationId === station.id && alert.status !== 'closed');
            const warningPdPoints = points.filter(point => isPdPoint(point) && typeof point.value === 'number' && point.value >= 20).length;

            return {
              station,
              devices,
              points,
              healthScores,
              avgHealth,
              onlineDevices: devices.filter(device => device.status === 'online').length,
              openAlerts: stationAlerts.length,
              warningPdPoints,
              hottestPoint: hottest,
            };
          })
        );

        setStations(snapshots);
        setAlerts(recentAlerts);
      } catch (err) {
        console.error('[CentralAnalytics] Load failed:', err);
        setStations([]);
        setAlerts([]);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, []);

  const fleetSummary = useMemo(() => {
    const totalStations = stations.length;
    const totalDevices = stations.reduce((sum, item) => sum + item.devices.length, 0);
    const totalOnline = stations.reduce((sum, item) => sum + item.onlineDevices, 0);
    const totalAlerts = stations.reduce((sum, item) => sum + item.openAlerts, 0);
    const totalPdWarnings = stations.reduce((sum, item) => sum + item.warningPdPoints, 0);
    const avgHealthValues = stations
      .map(item => item.avgHealth)
      .filter((value): value is number => value != null);
    const avgHealth = avgHealthValues.length > 0
      ? avgHealthValues.reduce((sum, value) => sum + value, 0) / avgHealthValues.length
      : null;

    const hottest = stations.reduce<{ stationName: string; stationId: string; value: number; label: string } | null>((max, item) => {
      if (!item.hottestPoint) return max;
      if (!max || item.hottestPoint.value > max.value) {
        return {
          stationName: item.station.name,
          stationId: item.station.id,
          value: item.hottestPoint.value,
          label: item.hottestPoint.label,
        };
      }
      return max;
    }, null);

    return { totalStations, totalDevices, totalOnline, totalAlerts, totalPdWarnings, avgHealth, hottest };
  }, [stations]);

  const rankedStations = useMemo(() => {
    return [...stations].sort((a, b) => {
      const riskA = a.openAlerts * 20 + (100 - (a.avgHealth ?? 100)) + a.warningPdPoints * 8 + (a.hottestPoint?.value ?? 0);
      const riskB = b.openAlerts * 20 + (100 - (b.avgHealth ?? 100)) + b.warningPdPoints * 8 + (b.hottestPoint?.value ?? 0);
      return riskB - riskA;
    });
  }, [stations]);

  const thermalRanking = useMemo(() => {
    return rankedStations
      .filter(item => item.hottestPoint)
      .sort((a, b) => (b.hottestPoint?.value ?? 0) - (a.hottestPoint?.value ?? 0));
  }, [rankedStations]);

  const pdRanking = useMemo(() => {
    return [...stations].sort((a, b) => b.warningPdPoints - a.warningPdPoints);
  }, [stations]);

  const healthRanking = useMemo(() => {
    return [...stations].sort((a, b) => (a.avgHealth ?? 999) - (b.avgHealth ?? 999));
  }, [stations]);

  const recentAlerts = useMemo(() => {
    return [...alerts]
      .sort((a, b) => new Date(b.triggeredAt).getTime() - new Date(a.triggeredAt).getTime())
      .slice(0, 10);
  }, [alerts]);

  const drillIntoStation = (stationId: string) => {
    localStorage.setItem(MULTISITE_RETURN_TAB_KEY, 'analytics');
    setViewingStation(stationId);
    navigate('/analytics?scope=station');
  };

  const renderOverview = () => (
    <div style={{ display: 'grid', gap: 24 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
        <MetricCard label="Trạm đang theo dõi" value={fleetSummary.totalStations} sub={`${fleetSummary.totalDevices} thiết bị`} icon={<Activity size={20} />} accentColor="var(--admin-accent)" />
        <MetricCard label="Thiết bị trực tuyến" value={`${fleetSummary.totalOnline}/${fleetSummary.totalDevices}`} sub="Toàn mạng lưới" icon={<Wifi size={20} />} accentColor="var(--admin-success)" />
        <MetricCard label="Cảnh báo chưa đóng" value={fleetSummary.totalAlerts} sub="Open và acked" icon={<AlertTriangle size={20} />} accentColor="var(--admin-danger)" />
        <MetricCard label="Điểm sức khỏe TB" value={fleetSummary.avgHealth != null ? fleetSummary.avgHealth.toFixed(1) : 'N/A'} sub={getHealthClass(fleetSummary.avgHealth).label} icon={<Radio size={20} />} accentColor="#f59e0b" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.8fr 1fr', gap: 24 }}>
        <section className="admin-card" style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--admin-border)', fontWeight: 800, fontSize: '.75rem', color: 'var(--admin-text)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Activity size={14} /> BẢNG XẾP HẠNG RỦI RO
          </div>
          <div style={{ overflowX: 'auto', flex: 1 }}>
            <table className="data-table" style={{ width: '100%', margin: 0 }}>
              <thead>
                <tr>
                  <th style={{ width: 40, textAlign: 'center' }}>#</th>
                  <th>Trạm</th>
                  <th style={{ textAlign: 'center' }}>Sức khỏe</th>
                  <th style={{ textAlign: 'center' }}>Hotspot</th>
                  <th style={{ textAlign: 'center' }}>PD</th>
                  <th style={{ textAlign: 'center' }}>Cảnh báo</th>
                </tr>
              </thead>
              <tbody>
                {rankedStations.map((item, idx) => (
                  <tr key={item.station.id} onClick={() => drillIntoStation(item.station.id)} style={{ cursor: 'pointer' }}>
                    <td style={{ textAlign: 'center', color: 'var(--admin-text-muted)', fontSize: '.7rem' }}>{idx + 1}</td>
                    <td>
                      <div style={{ color: 'var(--admin-text)', fontWeight: 800, fontSize: '.75rem' }}>{item.station.name}</div>
                      <div style={{ color: 'var(--admin-text-muted)', fontSize: '.65rem' }}>{item.station.code || 'NO-CODE'}</div>
                    </td>
                    <td style={{ textAlign: 'center', color: getHealthClass(item.avgHealth).color, fontWeight: 800 }}>
                      {item.avgHealth != null ? `${item.avgHealth.toFixed(1)}` : 'N/A'}
                    </td>
                    <td style={{ textAlign: 'center', color: getThermalClass(item.hottestPoint?.value ?? null).color, fontWeight: 800 }}>
                      {item.hottestPoint ? `${item.hottestPoint.value.toFixed(1)}°C` : '—'}
                    </td>
                    <td style={{ textAlign: 'center', color: getPdClass(item.warningPdPoints).color, fontWeight: 800 }}>
                      {item.warningPdPoints > 0 ? item.warningPdPoints : '—'}
                    </td>
                    <td style={{ textAlign: 'center', color: item.openAlerts > 0 ? 'var(--admin-danger)' : 'var(--admin-text-muted)', fontWeight: 800 }}>
                      {item.openAlerts > 0 ? item.openAlerts : '0'}
                    </td>
                  </tr>
                ))}
                {rankedStations.length === 0 && (
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', padding: 30, color: 'var(--admin-text-muted)', fontSize: '.7rem' }}>Không có dữ liệu trạm</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section style={{ display: 'grid', gap: 24 }}>
          <div className="admin-card" style={{ padding: 20, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--admin-text-muted)', fontWeight: 800, fontSize: '.7rem', letterSpacing: '0.05em' }}>
              <Thermometer size={14} /> ĐIỂM NÓNG NHẤT HỆ THỐNG
            </div>
            <div style={{ marginTop: 16, fontSize: '2.5rem', fontWeight: 900, color: 'var(--admin-danger)' }}>
              {fleetSummary.hottest ? `${fleetSummary.hottest.value.toFixed(1)}°C` : 'N/A'}
            </div>
            <div style={{ marginTop: 8, color: 'var(--admin-text)', fontSize: '.8rem', fontWeight: 700 }}>
              {fleetSummary.hottest ? fleetSummary.hottest.stationName : 'Chưa có dữ liệu nhiệt'}
            </div>
            <div style={{ color: 'var(--admin-text-muted)', fontSize: '.7rem', marginTop: 2 }}>
              {fleetSummary.hottest ? fleetSummary.hottest.label : '---'}
            </div>
            {fleetSummary.hottest && (
              <button className="btn-industrial" style={{ marginTop: 20, padding: '8px 12px', fontSize: '.7rem', fontWeight: 800, width: 'fit-content' }} onClick={() => drillIntoStation(fleetSummary.hottest!.stationId)}>
                KIỂM TRA NGAY
              </button>
            )}
          </div>

          <div className="admin-card" style={{ padding: 20, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--admin-text-muted)', fontWeight: 800, fontSize: '.7rem', letterSpacing: '0.05em' }}>
              <Zap size={14} /> DẤU HIỆU PD MẠNG LƯỚI
            </div>
            <div style={{ marginTop: 16, fontSize: '2.5rem', fontWeight: 900, color: fleetSummary.totalPdWarnings > 0 ? '#f59e0b' : 'var(--admin-success)' }}>
              {fleetSummary.totalPdWarnings}
            </div>
            <div style={{ marginTop: 8, color: 'var(--admin-text)', fontSize: '.8rem', fontWeight: 700 }}>
              {fleetSummary.totalPdWarnings > 0 ? 'Phát hiện tín hiệu bất thường' : 'Hệ thống điện ổn định'}
            </div>
             <div style={{ color: 'var(--admin-text-muted)', fontSize: '.7rem', marginTop: 2 }}>
              Cần phân tích phổ âm thanh chuyên sâu
            </div>
          </div>
        </section>
      </div>
    </div>
  );

  const renderThermal = () => (
    <div style={{ display: 'grid', gap: 24 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
        <MetricCard
          label="Hotspot cao nhất"
          value={fleetSummary.hottest ? `${fleetSummary.hottest.value.toFixed(1)}°C` : 'N/A'}
          sub={fleetSummary.hottest ? fleetSummary.hottest.stationName : 'Chưa có dữ liệu'}
          icon={<Thermometer size={20} />}
          accentColor="var(--admin-danger)"
        />
        <MetricCard
          label="Trạm có dữ liệu nhiệt"
          value={thermalRanking.length}
          sub={`${stations.length - thermalRanking.length} trạm chưa có nhiệt`}
          icon={<Activity size={20} />}
          accentColor="var(--admin-accent)"
        />
      </div>

      <section className="admin-card" style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--admin-border)', fontWeight: 800, fontSize: '.75rem', color: 'var(--admin-text)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Thermometer size={14} /> BẢNG XẾP HẠNG NHIỆT ĐỘ LIÊN TRẠM
        </div>
        <div style={{ overflowX: 'auto', flex: 1 }}>
          <table className="data-table" style={{ width: '100%', margin: 0 }}>
            <thead>
              <tr>
                <th style={{ width: 40, textAlign: 'center' }}>#</th>
                <th>Trạm</th>
                <th>Điểm đo nóng nhất</th>
                <th style={{ textAlign: 'center' }}>Nhiệt độ</th>
                <th style={{ textAlign: 'center' }}>Trạng thái</th>
              </tr>
            </thead>
            <tbody>
              {thermalRanking.map((item, idx) => {
                const thermalInfo = getThermalClass(item.hottestPoint?.value ?? null);
                return (
                  <tr key={item.station.id} onClick={() => drillIntoStation(item.station.id)} style={{ cursor: 'pointer' }}>
                    <td style={{ textAlign: 'center', color: 'var(--admin-text-muted)', fontSize: '.7rem' }}>{idx + 1}</td>
                    <td>
                      <div style={{ color: 'var(--admin-text)', fontWeight: 800, fontSize: '.75rem' }}>{item.station.name}</div>
                      <div style={{ color: 'var(--admin-text-muted)', fontSize: '.65rem' }}>{item.station.code || 'NO-CODE'}</div>
                    </td>
                    <td style={{ color: 'var(--admin-text-muted)', fontSize: '.7rem' }}>
                      {item.hottestPoint?.label || 'Không rõ'}
                    </td>
                    <td style={{ textAlign: 'center', color: thermalInfo.color, fontWeight: 900, fontSize: '1.1rem' }}>
                      {item.hottestPoint ? `${item.hottestPoint.value.toFixed(1)}°C` : 'N/A'}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <span style={{ 
                        background: thermalInfo.color === 'var(--admin-danger)' ? 'rgba(239,68,68,0.1)' : thermalInfo.color === '#f59e0b' ? 'rgba(245,158,11,0.1)' : 'rgba(16,185,129,0.1)',
                        color: thermalInfo.color, padding: '2px 8px', borderRadius: 4, fontSize: '.65rem', fontWeight: 800 
                      }}>
                        {thermalInfo.label.toUpperCase()}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {thermalRanking.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ textAlign: 'center', padding: 30, color: 'var(--admin-text-muted)', fontSize: '.7rem' }}>Chưa có dữ liệu nhiệt.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );

  const renderPd = () => (
    <div style={{ display: 'grid', gap: 24 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
        <MetricCard
          label="Điểm PD đáng chú ý"
          value={fleetSummary.totalPdWarnings}
          sub={getPdClass(fleetSummary.totalPdWarnings).label}
          icon={<Zap size={20} />}
          accentColor={fleetSummary.totalPdWarnings > 0 ? '#f59e0b' : 'var(--admin-success)'}
        />
        <MetricCard
          label="Trạm có PD"
          value={pdRanking.filter(item => item.warningPdPoints > 0).length}
          sub={`${pdRanking.filter(item => item.warningPdPoints === 0).length} trạm ổn định`}
          icon={<Radio size={20} />}
          accentColor={pdRanking.filter(item => item.warningPdPoints > 0).length > 0 ? '#f59e0b' : 'var(--admin-success)'}
        />
      </div>

      <section className="admin-card" style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--admin-border)', fontWeight: 800, fontSize: '.75rem', color: 'var(--admin-text)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Zap size={14} /> BẢNG XẾP HẠNG PHÓNG ĐIỆN LIÊN TRẠM
        </div>
        <div style={{ overflowX: 'auto', flex: 1 }}>
          <table className="data-table" style={{ width: '100%', margin: 0 }}>
            <thead>
              <tr>
                <th style={{ width: 40, textAlign: 'center' }}>#</th>
                <th>Trạm</th>
                <th style={{ textAlign: 'center' }}>Số điểm cảnh báo PD</th>
                <th style={{ textAlign: 'center' }}>Đánh giá rủi ro</th>
              </tr>
            </thead>
            <tbody>
              {pdRanking.map((item, idx) => {
                const pdInfo = getPdClass(item.warningPdPoints);
                return (
                  <tr key={item.station.id} onClick={() => drillIntoStation(item.station.id)} style={{ cursor: 'pointer' }}>
                    <td style={{ textAlign: 'center', color: 'var(--admin-text-muted)', fontSize: '.7rem' }}>{idx + 1}</td>
                    <td>
                      <div style={{ color: 'var(--admin-text)', fontWeight: 800, fontSize: '.75rem' }}>{item.station.name}</div>
                      <div style={{ color: 'var(--admin-text-muted)', fontSize: '.65rem' }}>{item.station.code || 'NO-CODE'}</div>
                    </td>
                    <td style={{ textAlign: 'center', color: pdInfo.color, fontWeight: 900, fontSize: '1.1rem' }}>
                      {item.warningPdPoints}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <span style={{ 
                        background: pdInfo.color === 'var(--admin-danger)' ? 'rgba(239,68,68,0.1)' : pdInfo.color === '#f59e0b' ? 'rgba(245,158,11,0.1)' : 'rgba(16,185,129,0.1)',
                        color: pdInfo.color, padding: '2px 8px', borderRadius: 4, fontSize: '.65rem', fontWeight: 800 
                      }}>
                        {pdInfo.label.toUpperCase()}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {pdRanking.length === 0 && (
                <tr>
                  <td colSpan={4} style={{ textAlign: 'center', padding: 30, color: 'var(--admin-text-muted)', fontSize: '.7rem' }}>Chưa có dữ liệu phóng điện.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );

  const renderHealth = () => (
    <div style={{ display: 'grid', gap: 24 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
        <MetricCard
          label="Sức khỏe trung bình"
          value={fleetSummary.avgHealth != null ? fleetSummary.avgHealth.toFixed(1) : 'N/A'}
          sub={getHealthClass(fleetSummary.avgHealth).label}
          icon={<Radio size={20} />}
          accentColor={getHealthClass(fleetSummary.avgHealth).color}
        />
        <MetricCard
          label="Trạm cần theo dõi"
          value={healthRanking.filter(item => (item.avgHealth ?? 100) < 75).length}
          sub="Điểm sức khỏe dưới 75"
          icon={<AlertTriangle size={20} />}
          accentColor={healthRanking.filter(item => (item.avgHealth ?? 100) < 75).length > 0 ? '#f59e0b' : 'var(--admin-success)'}
        />
      </div>

      <section className="admin-card" style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--admin-border)', fontWeight: 800, fontSize: '.75rem', color: 'var(--admin-text)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Radio size={14} /> TÌNH TRẠNG KẾT NỐI THIẾT BỊ LIÊN TRẠM
        </div>
        <div style={{ overflowX: 'auto', flex: 1 }}>
          <table className="data-table" style={{ width: '100%', margin: 0 }}>
            <thead>
              <tr>
                <th style={{ width: 40, textAlign: 'center' }}>#</th>
                <th>Trạm</th>
                <th style={{ textAlign: 'center' }}>Sức khỏe thiết bị (ĐTB)</th>
                <th style={{ textAlign: 'center' }}>Thiết bị Online</th>
                <th style={{ textAlign: 'center' }}>Tổng thiết bị giám sát</th>
              </tr>
            </thead>
            <tbody>
              {healthRanking.map((item, idx) => {
                const healthInfo = getHealthClass(item.avgHealth);
                return (
                  <tr key={item.station.id} onClick={() => drillIntoStation(item.station.id)} style={{ cursor: 'pointer' }}>
                    <td style={{ textAlign: 'center', color: 'var(--admin-text-muted)', fontSize: '.7rem' }}>{idx + 1}</td>
                    <td>
                      <div style={{ color: 'var(--admin-text)', fontWeight: 800, fontSize: '.75rem' }}>{item.station.name}</div>
                      <div style={{ color: 'var(--admin-text-muted)', fontSize: '.65rem' }}>{item.station.code || 'NO-CODE'}</div>
                    </td>
                    <td style={{ textAlign: 'center' }}>
                       <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                          <span style={{ color: healthInfo.color, fontWeight: 900, fontSize: '1.1rem', minWidth: 40 }}>
                            {item.avgHealth != null ? `${item.avgHealth.toFixed(1)}` : 'N/A'}
                          </span>
                          {item.avgHealth != null && (
                            <div style={{ width: 60, height: 4, background: 'var(--admin-layer-2)', borderRadius: 2, overflow: 'hidden' }}>
                              <div style={{ width: `${item.avgHealth}%`, height: '100%', background: healthInfo.color }} />
                            </div>
                          )}
                       </div>
                    </td>
                    <td style={{ textAlign: 'center', color: item.onlineDevices === item.devices.length && item.devices.length > 0 ? 'var(--admin-success)' : 'var(--admin-text)', fontWeight: 800 }}>
                      {item.onlineDevices} / {item.devices.length}
                    </td>
                    <td style={{ textAlign: 'center', color: 'var(--admin-text-muted)', fontWeight: 700 }}>
                      {item.healthScores.length} thiết bị
                    </td>
                  </tr>
                );
              })}
              {healthRanking.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ textAlign: 'center', padding: 30, color: 'var(--admin-text-muted)', fontSize: '.7rem' }}>Chưa có dữ liệu.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );

  const renderRecentAlerts = () => (
    <section className="admin-card" style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--admin-border)', fontWeight: 800, fontSize: '.75rem', color: 'var(--admin-text)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <AlertTriangle size={14} /> CẢNH BÁO MỚI NHẤT TOÀN HỆ THỐNG
      </div>
      <div style={{ display: 'grid' }}>
        {recentAlerts.map(alert => (
          <div key={alert.id} style={{ padding: '12px 16px', borderBottom: '1px solid var(--admin-border)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                 <span style={{ 
                    padding: '2px 8px', borderRadius: 4, fontSize: '.65rem', fontWeight: 900,
                    background: alert.level === 'alarm' ? 'rgba(239,68,68,0.1)' : 'rgba(245,158,11,0.1)',
                    color: alert.level === 'alarm' ? 'var(--admin-danger)' : '#f59e0b'
                 }}>
                    {alert.level.toUpperCase()}
                 </span>
                 <span style={{ color: 'var(--admin-text)', fontWeight: 800, fontSize: '.75rem' }}>
                   {alert.stationName || 'Không rõ trạm'}
                 </span>
              </div>
              <div style={{ color: 'var(--admin-text-muted)', fontSize: '.7rem', fontWeight: 700 }}>
                {new Date(alert.triggeredAt).toLocaleString('vi-VN')}
              </div>
            </div>
            <div style={{ marginTop: 8, color: 'var(--admin-text-muted)', fontSize: '.75rem', fontWeight: 600 }}>
              {alert.message}
            </div>
          </div>
        ))}
        {recentAlerts.length === 0 && (
          <div style={{ padding: 30, textAlign: 'center', color: 'var(--admin-text-muted)', fontSize: '.7rem' }}>Hệ thống không có cảnh báo nào gần đây.</div>
        )}
      </div>
    </section>
  );

  const tabs: { key: CentralTab; label: string }[] = [
    { key: 'overview', label: 'TỔNG QUAN' },
    { key: 'thermal', label: 'AI NHIỆT' },
    { key: 'pd', label: 'PHÓNG ĐIỆN' },
    { key: 'health', label: 'SỨC KHỎE' },
  ];

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--admin-bg)', height: '100%', overflow: 'hidden' }}>
      
      {/* Analytics Sub-Nav (Mosaic Style) */}
      <div style={{ display: 'flex', gap: 4, padding: '10px 20px', background: 'var(--admin-panel)', borderBottom: '1px solid var(--admin-border)', alignItems: 'center', overflowX: 'auto' }}>
        {[
          { id: 'overview', label: 'TỔNG QUAN', icon: <Activity size={12} /> },
          { id: 'thermal', label: 'BẢN ĐỒ NHIỆT', icon: <Thermometer size={12} /> },
          { id: 'pd', label: 'PHÓNG ĐIỆN', icon: <Zap size={12} /> },
          { id: 'health', label: 'SỨC KHỎE THIẾT BỊ', icon: <Radio size={12} /> }
        ].map(t => (
          <button
            key={t.id}
            className="btn-industrial"
            onClick={() => setActiveTab(t.id as CentralTab)}
            style={{
              padding: '6px 14px',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: '0.65rem',
              fontWeight: 900,
              letterSpacing: '0.05em',
              background: activeTab === t.id ? 'var(--admin-accent)' : 'var(--admin-layer-2)',
              color: activeTab === t.id ? '#000' : 'var(--admin-text)',
              borderColor: activeTab === t.id ? 'var(--admin-accent)' : 'var(--admin-border)',
              borderBottom: activeTab === t.id ? 'none' : '1px solid var(--admin-border)'
            }}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* Main Content Area */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--admin-text-muted)', fontSize: '0.8rem', fontWeight: 700, letterSpacing: '0.05em' }}>
            <Activity size={32} style={{ opacity: 0.2, marginBottom: 16 }} />
            <div>ĐANG TỔNG HỢP DỮ LIỆU PHÂN TÍCH...</div>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 24 }}>
            {activeTab === 'overview' && renderOverview()}
            {activeTab === 'thermal' && renderThermal()}
            {activeTab === 'pd' && renderPd()}
            {activeTab === 'health' && renderHealth()}
            {renderRecentAlerts()}
          </div>
        )}
      </div>
    </div>
  );
}
