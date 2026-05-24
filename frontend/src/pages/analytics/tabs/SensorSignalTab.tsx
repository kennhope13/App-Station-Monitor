import { AnalyticsData } from '../types';

export default function SensorSignalTab({ }: { data: AnalyticsData }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, height: '100%', overflow: 'auto' }}>
      <div style={{ background: 'var(--admin-panel)', border: '1px solid var(--admin-border)', borderRadius: 8, padding: 16 }}>
        <h3 style={{ margin: '0 0 12px 0', fontSize: '0.8rem', fontWeight: 700, color: 'var(--admin-text)' }}>Quản Lý Nguồn & Pin Sensor</h3>
        <p style={{ fontSize: '0.75rem', color: 'var(--admin-text-muted)' }}>Bảng theo dõi trạng thái PIN và cường độ sóng (RSSI) của toàn bộ các cảm biến không dây trong trạm điện.</p>
      </div>
    </div>
  );
}
