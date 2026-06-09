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

function MetricCard({ label, value, sub, icon }: { label: string; value: string | number; sub: string; icon: React.ReactNode }) {
  return (
    <div style={{ border: '1px solid var(--admin-border)', background: 'var(--admin-panel)', padding: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: 'var(--admin-text-muted)', fontSize: '.72rem', fontWeight: 700 }}>
        <span>{label}</span>
        <span>{icon}</span>
      </div>
      <div style={{ marginTop: 10, fontSize: '1.65rem', fontWeight: 800, color: 'var(--admin-text)' }}>{value}</div>
      <div style={{ marginTop: 6, fontSize: '.72rem', color: 'var(--admin-text-muted)' }}>{sub}</div>
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
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
        <MetricCard label="Trạm đang theo dõi" value={fleetSummary.totalStations} sub={`${fleetSummary.totalDevices} thiết bị`} icon={<Activity size={16} />} />
        <MetricCard label="Thiết bị trực tuyến" value={`${fleetSummary.totalOnline}/${fleetSummary.totalDevices}`} sub="Toàn mạng lưới" icon={<Wifi size={16} />} />
        <MetricCard label="Cảnh báo chưa đóng" value={fleetSummary.totalAlerts} sub="Open và acked" icon={<AlertTriangle size={16} />} />
        <MetricCard label="Điểm sức khỏe TB" value={fleetSummary.avgHealth != null ? fleetSummary.avgHealth.toFixed(1) : 'N/A'} sub={getHealthClass(fleetSummary.avgHealth).label} icon={<Radio size={16} />} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 16 }}>
        <section style={{ border: '1px solid var(--admin-border)', background: 'var(--admin-panel)' }}>
          <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--admin-border)', fontWeight: 800, fontSize: '.78rem', color: 'var(--admin-text)' }}>
            Xếp hạng rủi ro
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--admin-layer-2)', color: 'var(--admin-text-muted)', fontSize: '.7rem' }}>
                  <th style={{ textAlign: 'left', padding: '10px 12px' }}>Trạm</th>
                  <th style={{ textAlign: 'left', padding: '10px 12px' }}>Sức khỏe</th>
                  <th style={{ textAlign: 'left', padding: '10px 12px' }}>Hotspot</th>
                  <th style={{ textAlign: 'left', padding: '10px 12px' }}>PD</th>
                  <th style={{ textAlign: 'left', padding: '10px 12px' }}>Cảnh báo</th>
                  <th style={{ textAlign: 'left', padding: '10px 12px' }} />
                </tr>
              </thead>
              <tbody>
                {rankedStations.map(item => (
                  <tr key={item.station.id} style={{ borderTop: '1px solid var(--admin-border)' }}>
                    <td style={{ padding: '12px' }}>
                      <div style={{ color: 'var(--admin-text)', fontWeight: 700 }}>{item.station.name}</div>
                      <div style={{ color: 'var(--admin-text-muted)', fontSize: '.72rem' }}>{item.station.code}</div>
                    </td>
                    <td style={{ padding: '12px', color: getHealthClass(item.avgHealth).color }}>
                      {item.avgHealth != null ? `${item.avgHealth.toFixed(1)} / 100` : 'N/A'}
                    </td>
                    <td style={{ padding: '12px', color: getThermalClass(item.hottestPoint?.value ?? null).color }}>
                      {item.hottestPoint ? `${item.hottestPoint.value.toFixed(1)}°C` : 'Không có'}
                    </td>
                    <td style={{ padding: '12px', color: getPdClass(item.warningPdPoints).color }}>{item.warningPdPoints}</td>
                    <td style={{ padding: '12px', color: 'var(--admin-text)' }}>{item.openAlerts}</td>
                    <td style={{ padding: '12px' }}>
                      <button className="btn-industrial btn-sm" onClick={() => drillIntoStation(item.station.id)} style={{ fontSize: '.68rem', padding: '4px 8px' }}>
                        Vào trạm
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section style={{ display: 'grid', gap: 16 }}>
          <div style={{ border: '1px solid var(--admin-border)', background: 'var(--admin-panel)', padding: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--admin-text)', fontWeight: 800, fontSize: '.78rem' }}>
              <Thermometer size={15} /> Điểm nóng cao nhất toàn hệ thống
            </div>
            <div style={{ marginTop: 12, fontSize: '1.7rem', fontWeight: 900, color: 'var(--admin-text)' }}>
              {fleetSummary.hottest ? `${fleetSummary.hottest.value.toFixed(1)}°C` : 'N/A'}
            </div>
            <div style={{ marginTop: 8, color: 'var(--admin-text-muted)', fontSize: '.74rem' }}>
              {fleetSummary.hottest ? `${fleetSummary.hottest.stationName} · ${fleetSummary.hottest.label}` : 'Chưa có dữ liệu nhiệt'}
            </div>
            {fleetSummary.hottest && (
              <button className="btn-industrial btn-sm" style={{ marginTop: 12, fontSize: '.68rem', padding: '4px 8px' }} onClick={() => drillIntoStation(fleetSummary.hottest!.stationId)}>
                Đi tới trạm nóng nhất
              </button>
            )}
          </div>

          <div style={{ border: '1px solid var(--admin-border)', background: 'var(--admin-panel)', padding: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--admin-text)', fontWeight: 800, fontSize: '.78rem' }}>
              <Zap size={15} /> Dấu hiệu PD toàn mạng
            </div>
            <div style={{ marginTop: 12, fontSize: '1.7rem', fontWeight: 900, color: 'var(--admin-text)' }}>
              {fleetSummary.totalPdWarnings}
            </div>
            <div style={{ marginTop: 8, color: getPdClass(fleetSummary.totalPdWarnings).color, fontSize: '.74rem', fontWeight: 700 }}>
              {getPdClass(fleetSummary.totalPdWarnings).label}
            </div>
          </div>
        </section>
      </div>
    </div>
  );

  const renderThermal = () => (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
        <MetricCard
          label="Hotspot cao nhất"
          value={fleetSummary.hottest ? `${fleetSummary.hottest.value.toFixed(1)}°C` : 'N/A'}
          sub={fleetSummary.hottest ? fleetSummary.hottest.stationName : 'Chưa có dữ liệu'}
          icon={<Thermometer size={16} />}
        />
        <MetricCard
          label="Trạm có dữ liệu nhiệt"
          value={thermalRanking.length}
          sub={`${stations.length - thermalRanking.length} trạm chưa có nhiệt`}
          icon={<Activity size={16} />}
        />
      </div>

      <section style={{ border: '1px solid var(--admin-border)', background: 'var(--admin-panel)' }}>
        <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--admin-border)', fontWeight: 800, fontSize: '.78rem', color: 'var(--admin-text)' }}>
          Phân tích nhiệt liên trạm
        </div>
        <div style={{ display: 'grid', gap: 10, padding: 14 }}>
          {thermalRanking.map(item => {
            const thermalInfo = getThermalClass(item.hottestPoint?.value ?? null);
            return (
              <div key={item.station.id} style={{ border: '1px solid var(--admin-border)', padding: 12, display: 'grid', gridTemplateColumns: '1.3fr 0.7fr 0.7fr auto', gap: 12, alignItems: 'center' }}>
                <div>
                  <div style={{ color: 'var(--admin-text)', fontWeight: 700 }}>{item.station.name}</div>
                  <div style={{ color: 'var(--admin-text-muted)', fontSize: '.72rem' }}>{item.hottestPoint?.label || 'Không rõ điểm đo'}</div>
                </div>
                <div style={{ color: thermalInfo.color, fontWeight: 800 }}>{item.hottestPoint ? `${item.hottestPoint.value.toFixed(1)}°C` : 'N/A'}</div>
                <div style={{ color: thermalInfo.color, fontSize: '.74rem', fontWeight: 700 }}>{thermalInfo.label}</div>
                <button className="btn-industrial btn-sm" onClick={() => drillIntoStation(item.station.id)} style={{ fontSize: '.68rem', padding: '4px 8px' }}>
                  Xem chi tiết
                </button>
              </div>
            );
          })}
          {thermalRanking.length === 0 && (
            <div style={{ color: 'var(--admin-text-muted)' }}>Chưa có dữ liệu nhiệt.</div>
          )}
        </div>
      </section>
    </div>
  );

  const renderPd = () => (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
        <MetricCard
          label="Điểm PD đáng chú ý"
          value={fleetSummary.totalPdWarnings}
          sub={getPdClass(fleetSummary.totalPdWarnings).label}
          icon={<Zap size={16} />}
        />
        <MetricCard
          label="Trạm có PD"
          value={pdRanking.filter(item => item.warningPdPoints > 0).length}
          sub={`${pdRanking.filter(item => item.warningPdPoints === 0).length} trạm ổn định`}
          icon={<Radio size={16} />}
        />
      </div>

      <section style={{ border: '1px solid var(--admin-border)', background: 'var(--admin-panel)' }}>
        <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--admin-border)', fontWeight: 800, fontSize: '.78rem', color: 'var(--admin-text)' }}>
          Phân tích phóng điện liên trạm
        </div>
        <div style={{ display: 'grid', gap: 10, padding: 14 }}>
          {pdRanking.map(item => {
            const pdInfo = getPdClass(item.warningPdPoints);
            return (
              <div key={item.station.id} style={{ border: '1px solid var(--admin-border)', padding: 12, display: 'grid', gridTemplateColumns: '1.3fr 0.7fr 0.9fr auto', gap: 12, alignItems: 'center' }}>
                <div>
                  <div style={{ color: 'var(--admin-text)', fontWeight: 700 }}>{item.station.name}</div>
                  <div style={{ color: 'var(--admin-text-muted)', fontSize: '.72rem' }}>{item.station.code}</div>
                </div>
                <div style={{ color: pdInfo.color, fontWeight: 800 }}>{item.warningPdPoints}</div>
                <div style={{ color: pdInfo.color, fontSize: '.74rem', fontWeight: 700 }}>{pdInfo.label}</div>
                <button className="btn-industrial btn-sm" onClick={() => drillIntoStation(item.station.id)} style={{ fontSize: '.68rem', padding: '4px 8px' }}>
                  Xem chi tiết
                </button>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );

  const renderHealth = () => (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
        <MetricCard
          label="Sức khỏe trung bình"
          value={fleetSummary.avgHealth != null ? fleetSummary.avgHealth.toFixed(1) : 'N/A'}
          sub={getHealthClass(fleetSummary.avgHealth).label}
          icon={<Radio size={16} />}
        />
        <MetricCard
          label="Trạm cần theo dõi"
          value={healthRanking.filter(item => (item.avgHealth ?? 100) < 75).length}
          sub="Điểm sức khỏe dưới 75"
          icon={<AlertTriangle size={16} />}
        />
      </div>

      <section style={{ border: '1px solid var(--admin-border)', background: 'var(--admin-panel)' }}>
        <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--admin-border)', fontWeight: 800, fontSize: '.78rem', color: 'var(--admin-text)' }}>
          Phân tích sức khỏe thiết bị theo trạm
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--admin-layer-2)', color: 'var(--admin-text-muted)', fontSize: '.7rem' }}>
                <th style={{ textAlign: 'left', padding: '10px 12px' }}>Trạm</th>
                <th style={{ textAlign: 'left', padding: '10px 12px' }}>Điểm TB</th>
                <th style={{ textAlign: 'left', padding: '10px 12px' }}>Thiết bị online</th>
                <th style={{ textAlign: 'left', padding: '10px 12px' }}>Thiết bị chấm điểm</th>
                <th style={{ textAlign: 'left', padding: '10px 12px' }} />
              </tr>
            </thead>
            <tbody>
              {healthRanking.map(item => {
                const healthInfo = getHealthClass(item.avgHealth);
                return (
                  <tr key={item.station.id} style={{ borderTop: '1px solid var(--admin-border)' }}>
                    <td style={{ padding: '12px' }}>
                      <div style={{ color: 'var(--admin-text)', fontWeight: 700 }}>{item.station.name}</div>
                      <div style={{ color: 'var(--admin-text-muted)', fontSize: '.72rem' }}>{item.station.code}</div>
                    </td>
                    <td style={{ padding: '12px', color: healthInfo.color, fontWeight: 800 }}>
                      {item.avgHealth != null ? `${item.avgHealth.toFixed(1)} / 100` : 'N/A'}
                    </td>
                    <td style={{ padding: '12px', color: 'var(--admin-text)' }}>
                      {item.onlineDevices}/{item.devices.length}
                    </td>
                    <td style={{ padding: '12px', color: 'var(--admin-text)' }}>
                      {item.healthScores.length}
                    </td>
                    <td style={{ padding: '12px' }}>
                      <button className="btn-industrial btn-sm" onClick={() => drillIntoStation(item.station.id)} style={{ fontSize: '.68rem', padding: '4px 8px' }}>
                        Xem chi tiết
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );

  const renderRecentAlerts = () => (
    <section style={{ border: '1px solid var(--admin-border)', background: 'var(--admin-panel)' }}>
      <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--admin-border)', fontWeight: 800, fontSize: '.78rem', color: 'var(--admin-text)' }}>
        Cảnh báo mới nhất toàn hệ thống
      </div>
      <div style={{ display: 'grid' }}>
        {recentAlerts.map(alert => (
          <div key={alert.id} style={{ padding: '10px 14px', borderTop: '1px solid var(--admin-border)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <div style={{ color: 'var(--admin-text)', fontWeight: 700, fontSize: '.73rem' }}>
                {alert.stationName || 'Không rõ trạm'}
              </div>
              <div style={{ color: 'var(--admin-text-muted)', fontSize: '.7rem' }}>
                {new Date(alert.triggeredAt).toLocaleString('vi-VN')}
              </div>
            </div>
            <div style={{ marginTop: 4, color: 'var(--admin-text-muted)', fontSize: '.74rem' }}>
              {alert.message}
            </div>
          </div>
        ))}
        {recentAlerts.length === 0 && (
          <div style={{ padding: 14, color: 'var(--admin-text-muted)' }}>Không có cảnh báo gần đây.</div>
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 2, borderBottom: '1px solid var(--admin-border)' }}>
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            style={{
              padding: '7px 18px',
              border: 'none',
              borderBottom: activeTab === t.key ? '2px solid var(--admin-accent)' : '2px solid transparent',
              background: 'transparent',
              color: activeTab === t.key ? 'var(--admin-accent)' : 'var(--admin-text-muted)',
              fontSize: '0.7rem',
              fontWeight: 800,
              cursor: 'pointer',
              letterSpacing: 1,
              marginBottom: -1,
              transition: 'color 0.15s'
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ padding: 24, color: 'var(--admin-text-muted)', fontSize: '0.8rem' }}>Đang tổng hợp dữ liệu phân tích...</div>
      ) : (
        <div style={{ display: 'grid', gap: 16 }}>
          {activeTab === 'overview' && renderOverview()}
          {activeTab === 'thermal' && renderThermal()}
          {activeTab === 'pd' && renderPd()}
          {activeTab === 'health' && renderHealth()}
          {renderRecentAlerts()}
        </div>
      )}
    </div>
  );
}
