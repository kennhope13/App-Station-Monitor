// ============================================================
// ThemeTab.tsx — Tab "Giao diện"
// Chọn theme (dark/light) và áp dụng toàn ứng dụng
// Lưu vào localStorage key: station-theme
// ============================================================

import { useState, useEffect } from 'react';
import { setTheme as setGlobalTheme } from '@/utils/theme-manager';
import { showToast } from '@/utils/toast';

const THEME_OPTIONS = [
  {
    key: 'dark',
    label: 'Tối công nghiệp',
    bg: '#090e1a', panel: '#0f172a', sidebar: '#05080f',
    border: '#1e293b', accent: '#3b82f6', text: '#ffffff',
  },
  {
    key: 'light',
    label: 'Sáng tiêu chuẩn',
    bg: '#f1f5f9', panel: '#ffffff', sidebar: '#ffffff',
    border: '#cbd5e1', accent: '#2563eb', text: '#0f172a',
  },
];

export default function ThemeTab() {
  const [theme, setTheme] = useState('dark');

  useEffect(() => {
    setTheme(localStorage.getItem('station-theme') || 'dark');
  }, []);

  const handleSaveTheme = () => {
    setGlobalTheme(theme as any);
    showToast('Đã áp dụng giao diện mới', 'success');
  };

  return (
    <div>
      <div className="card-title">CÀI ĐẶT GIAO DIỆN</div>
      <div className="form-group">
        <label>THEME (GIAO DIỆN MÀU)</label>
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginTop: 10 }}>
          {THEME_OPTIONS.map(opt => (
            <div key={opt.key} className={`theme-option ${theme === opt.key ? 'active' : ''}`} onClick={() => setTheme(opt.key)}>
              <div
                className="theme-preview"
                style={{
                  display: 'flex', flexDirection: 'column',
                  width: 130, height: 80, borderRadius: 6, overflow: 'hidden',
                  border: theme === opt.key ? '2px solid var(--admin-accent)' : '2px solid var(--admin-border)',
                  background: opt.bg, boxShadow: 'var(--admin-shadow)', transition: 'all 0.15s',
                }}
              >
                {/* Mini Header */}
                <div style={{ height: 12, background: opt.panel, borderBottom: `1px solid ${opt.border}`, display: 'flex', alignItems: 'center', padding: '0 4px', gap: 2, flexShrink: 0 }}>
                  <div style={{ width: 4, height: 4, borderRadius: '50%', background: opt.accent }} />
                  <div style={{ width: 24, height: 3, background: opt.text, opacity: 0.3, borderRadius: 1 }} />
                </div>
                {/* Mini Body */}
                <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
                  {/* Mini Sidebar */}
                  <div style={{ width: 18, background: opt.sidebar, borderRight: `1px solid ${opt.border}`, display: 'flex', flexDirection: 'column', padding: 2, gap: 2, flexShrink: 0 }}>
                    <div style={{ width: 12, height: 3, background: opt.accent, borderRadius: 1 }} />
                    <div style={{ width: 12, height: 2, background: opt.text, opacity: 0.2, borderRadius: 1 }} />
                    <div style={{ width: 12, height: 2, background: opt.text, opacity: 0.2, borderRadius: 1 }} />
                  </div>
                  {/* Mini Content */}
                  <div style={{ flex: 1, background: opt.bg, padding: 4, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 3, boxSizing: 'border-box' }}>
                    <div style={{ background: opt.panel, border: `1px solid ${opt.border}`, borderRadius: 2, display: 'flex', flexDirection: 'column', padding: 2, gap: 1, boxSizing: 'border-box' }}>
                      <div style={{ width: 10, height: 2, background: opt.text, opacity: 0.3, borderRadius: 0.5 }} />
                      <div style={{ width: 15, height: 4, background: opt.accent, borderRadius: 1 }} />
                    </div>
                    <div style={{ background: opt.panel, border: `1px solid ${opt.border}`, borderRadius: 2, display: 'flex', flexDirection: 'column', padding: 2, gap: 1, boxSizing: 'border-box' }}>
                      <div style={{ width: 10, height: 2, background: opt.text, opacity: 0.3, borderRadius: 0.5 }} />
                      <div style={{ width: 12, height: 3, background: opt.text, opacity: 0.1, borderRadius: 1 }} />
                    </div>
                    <div style={{ gridColumn: 'span 2', background: opt.panel, border: `1px solid ${opt.border}`, borderRadius: 2 }} />
                  </div>
                </div>
              </div>
              <span style={{ fontWeight: 600, marginTop: 4 }}>{opt.label}</span>
            </div>
          ))}
        </div>
      </div>
      <button className="btn-industrial btn-primary" style={{ marginTop: 16 }} onClick={handleSaveTheme}>
        Áp dụng giao diện
      </button>
    </div>
  );
}
