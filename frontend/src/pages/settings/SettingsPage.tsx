// ============================================================
// SettingsPage.tsx — Cài đặt hệ thống (6 tab)
// Tab 0: Cài đặt chung  (GeneralTab)
// Tab 1: Thông báo      (NotificationTab)
// Tab 2: DB & Backup    (DatabaseTab)
// Tab 3: Giao diện      (ThemeTab)
// Tab 4: Cloud Sync     (CloudSyncTab)
// Tab 5: Liên kết Camera(LinkageTab)
// Mỗi tab tự load và lưu dữ liệu riêng.
// ============================================================

import { useState } from 'react';
import GeneralTab from './tabs/GeneralTab';
import NotificationTab from './tabs/NotificationTab';
import DatabaseTab from './tabs/DatabaseTab';
import ThemeTab from './tabs/ThemeTab';
import CloudSyncTab from './tabs/CloudSyncTab';
import LinkageTab from './tabs/LinkageTab';
import './SettingsPage.css';

const TABS = ['Cài đặt chung', 'Thông báo', 'Database & Backup', 'Giao diện', 'Cloud Sync', 'Liên kết Camera'];

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState(0);

  return (
    <div className="admin-page-container">
      <div className="page-toolbar-row" style={{ flexWrap: 'wrap', rowGap: 6 }}>
        <div className="page-title-cell">
          <h2>CÀI ĐẶT HỆ THỐNG</h2>
        </div>
        <div className="page-toolbar-group" style={{ flexWrap: 'wrap' }}>
          {TABS.map((t, idx) => (
            <button
              key={idx}
              onClick={() => setActiveTab(idx)}
              className={`btn-industrial${activeTab === idx ? ' btn-primary' : ''}`}
              style={{ height: 34, padding: '0 14px', fontSize: '.72rem', fontWeight: 700, letterSpacing: '.3px' }}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className="admin-card" style={{ flex: 1, overflow: 'auto', padding: '20px 24px', borderRadius: 4 }}>
        {activeTab === 0 && <GeneralTab />}
        {activeTab === 1 && <NotificationTab />}
        {activeTab === 2 && <DatabaseTab />}
        {activeTab === 3 && <ThemeTab />}
        {activeTab === 4 && <CloudSyncTab />}
        {activeTab === 5 && <LinkageTab />}
      </div>
    </div>
  );
}
