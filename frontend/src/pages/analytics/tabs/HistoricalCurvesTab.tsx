import { AnalyticsData } from '../types';

export default function HistoricalCurvesTab({ }: { data: AnalyticsData }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, height: '100%', overflow: 'auto' }}>
      <div style={{ background: 'var(--admin-panel)', border: '1px solid var(--admin-border)', borderRadius: 8, padding: 16 }}>
        <h3 style={{ margin: '0 0 12px 0', fontSize: '0.8rem', fontWeight: 700, color: 'var(--admin-text)' }}>Xu Hướng & Tương Quan Lịch Sử</h3>
        <p style={{ fontSize: '0.75rem', color: 'var(--admin-text-muted)' }}>Giao diện cho phép chọn nhiều điểm đo từ nhiều tủ điện khác nhau để so sánh xu hướng nhiệt độ và phóng điện theo thời gian.</p>
      </div>
    </div>
  );
}
