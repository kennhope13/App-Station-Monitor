// ============================================================
// App.tsx — Cấu trúc routing chính của ứng dụng
// Sử dụng React Router v7, lazy loading từng trang để giảm bundle size
// Tất cả trang trừ /login đều yêu cầu đăng nhập (ProtectedRoute)
// ============================================================

import React, { Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import AppShell from '@/components/layout/AppShell';

// Lazy import — mỗi trang là một chunk riêng, tải khi cần
const DashboardPage = React.lazy(() => import('@/pages/dashboard/DashboardPage'));
const RealtimeMonitorPage = React.lazy(() => import('@/pages/realtime-monitor/RealtimeMonitorPage'));
const AlertsHistoryPage = React.lazy(() => import('@/pages/alerts-history/AlertsHistoryPage'));
const AlertDetailPage = React.lazy(() => import('@/pages/alert-detail/AlertDetailPage'));
const AnalyticsLayout = React.lazy(() => import('@/pages/analytics/AnalyticsLayout'));
const ReportsPage = React.lazy(() => import('@/pages/reports/ReportsPage'));
const MaintenancePage = React.lazy(() => import('@/pages/maintenance/MaintenancePage'));
const AuditLogPage = React.lazy(() => import('@/pages/audit-log/AuditLogPage'));
const MultisitePage = React.lazy(() => import('@/pages/multisite/MultisitePage'));
const DeviceManagementPage = React.lazy(() => import('@/pages/device-management/DeviceManagementPage'));
const ThermalConfigPage = React.lazy(() => import('@/pages/device-management/ThermalConfigPage'));
const UserManagementPage = React.lazy(() => import('@/pages/user-management/UserManagementPage'));
const RuleEnginePage = React.lazy(() => import('@/pages/rule-engine/RuleEnginePage'));
const SettingsPage = React.lazy(() => import('@/pages/settings/SettingsPage'));
const LoginPage = React.lazy(() => import('@/pages/login/LoginPage'));
const LicensePage = React.lazy(() => import('@/pages/license/LicensePage'));

// Bảo vệ route — Tạm thời tắt kiểm tra đăng nhập để bạn có thể xem trực tiếp giao diện trên trình duyệt của mình
const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  return <>{children}</>;
};

const ScreenLoader = () => {
  const bg = '#090e1a';
  const text = '#edf2fc';
  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: bg,
      color: text,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: 'monospace',
      fontSize: '14px',
      fontWeight: 'bold',
      zIndex: 9999
    }}>
      Loading...
    </div>
  );
};

export default function App() {
  return (
    <BrowserRouter>
      {/* Suspense hiển thị fallback trong khi chunk JS đang tải */}
      <Suspense fallback={<ScreenLoader />}>
        <Routes>
          {/* Trang đăng nhập — không cần xác thực */}
          <Route path="/login" element={<LoginPage />} />

          {/* AppShell bọc toàn bộ layout (sidebar + header + content) */}
          <Route path="/" element={<ProtectedRoute><AppShell /></ProtectedRoute>}>
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="dashboard" element={<DashboardPage />} />
            <Route path="realtime" element={<RealtimeMonitorPage />} />
            <Route path="alerts-history" element={<AlertsHistoryPage />} />
            <Route path="alert-detail" element={<AlertDetailPage />} />

            {/* Analytics — internal tabs, no nested routes */}
            <Route path="analytics" element={<AnalyticsLayout />} />

            <Route path="reports" element={<ReportsPage />} />
            <Route path="maintenance" element={<MaintenancePage />} />
            <Route path="audit-log" element={<AuditLogPage />} />
            <Route path="multisite" element={<MultisitePage />} />
            <Route path="device-management" element={<DeviceManagementPage />} />
            <Route path="device-management/:deviceId/thermal-config" element={<ThermalConfigPage />} />
            <Route path="user-management" element={<UserManagementPage />} />
            <Route path="rule-engine" element={<RuleEnginePage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="license" element={<LicensePage />} />
            <Route path="*" element={<div style={{color:'var(--admin-text)', padding:20}}>404 - Page not found</div>} />
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
