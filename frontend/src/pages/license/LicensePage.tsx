import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { authService } from '@/services/AuthService';
import { stationApi } from '@/services/StationApiService';
import './LicensePage.css';

interface LicenseStatus {
  activated: boolean;
  tier?: string;
  maxUsers?: number;
  expiresAt?: string;
  activatedAt?: string;
  activeSessions?: number;
  isValid?: boolean;
  daysRemaining?: number;
}

export default function LicensePage() {
  const navigate = useNavigate();
  
  const [status, setStatus] = useState<LicenseStatus | null>(null);
  const [key, setKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const isAdmin = authService.getUser()?.role === 'admin';

  const loadStatus = async () => {
    try {
      const data = await stationApi.getLicenseStatus();
      setStatus(data);
    } catch {
      setStatus({ activated: false });
    }
  };

  useEffect(() => {
    loadStatus();
  }, []);

  const handleActivate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!key.trim()) {
      setErrorMsg('Vui lòng nhập license key');
      return;
    }

    setLoading(true);
    setErrorMsg('');
    setSuccessMsg('');

    try {
      const data = await stationApi.activateLicense(key.trim());
      if (data?.message && !data?.activated) {
        setErrorMsg(data.message ?? 'Kích hoạt thất bại');
      } else {
        setSuccessMsg('Kích hoạt thành công! Đang tải lại...');
        setKey('');
        await loadStatus();
        setTimeout(() => navigate('/dashboard'), 1500);
      }
    } catch (err: any) {
      setErrorMsg(err?.message ?? 'Không thể kết nối backend');
    } finally {
      setLoading(false);
    }
  };

  const getTierClass = (tier: string) => {
    if (tier === 'solo') return 'solo';
    if (tier === 'team') return 'team';
    return 'ent';
  };

  const renderStatusBox = () => {
    if (!status) {
      return <div style={{ color: 'var(--admin-text-muted)', fontSize: 13, textAlign: 'center', padding: 20 }}>Đang tải trạng thái...</div>;
    }

    if (!status.activated) {
      return (
        <div className="status-box">
          <div className="status-row">
            <span>Trạng thái</span>
            <span className="status-badge demo">Chưa kích hoạt (Demo)</span>
          </div>
          <div className="status-row">
            <span>Giới hạn</span>
            <span>Không giới hạn (chế độ thử nghiệm)</span>
          </div>
        </div>
      );
    }

    const tierLabel = status.tier === 'solo' ? 'Solo' : status.tier === 'team' ? 'Team' : status.tier === 'enterprise' ? 'Enterprise' : status.tier;
    const expDate = status.expiresAt ? new Date(status.expiresAt).toLocaleDateString('vi-VN') : '—';
    const actDate = status.activatedAt ? new Date(status.activatedAt).toLocaleDateString('vi-VN') : '—';
    const statusCls = status.isValid ? 'valid' : 'expired';
    const statusTxt = status.isValid ? 'Đang hoạt động' : 'Đã hết hạn';

    return (
      <div className={`status-box ${statusCls}`}>
        <div className="status-row">
          <span>Trạng thái</span>
          <span className={`status-badge ${statusCls}`}>{statusTxt}</span>
        </div>
        <div className="status-row">
          <span>Gói</span>
          <span>
            <span className={`tier-pill ${status.tier ? getTierClass(status.tier) : ''}`}>
              {tierLabel}
            </span>
          </span>
        </div>
        <div className="status-row">
          <span>Số người dùng tối đa</span>
          <span>{status.maxUsers && status.maxUsers >= 999 ? 'Không giới hạn' : status.maxUsers}</span>
        </div>
        <div className="status-row">
          <span>Phiên đang hoạt động</span>
          <span>{status.activeSessions ?? 0} / {status.maxUsers && status.maxUsers >= 999 ? '∞' : status.maxUsers}</span>
        </div>
        <div className="status-row">
          <span>Ngày hết hạn</span>
          <span>{expDate} (còn {status.daysRemaining ?? 0} ngày)</span>
        </div>
        <div className="status-row">
          <span>Ngày kích hoạt</span>
          <span>{actDate}</span>
        </div>
      </div>
    );
  };

  return (
    <div className="license-page">
      <div className="license-hero">
        <div className="license-card">
          <div className="license-header">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#44ff88" strokeWidth="1.5">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            <h1>Quản lý License</h1>
            <p>Kích hoạt bản quyền phần mềm StationMonitor</p>
          </div>

          {renderStatusBox()}

          {isAdmin && (
            <div className="license-activate-section" id="activateSection">
              <h3>Kích hoạt License Key</h3>
              <p className="license-hint">
                Nhập license key do nhà cung cấp cấp. Định dạng: <code>SOLO-YYMMDD-XXXX-XXXXXXXX</code>
              </p>

              {errorMsg && <div className="license-error">️ {errorMsg}</div>}
              {successMsg && <div className="license-success">{successMsg}</div>}

              <form onSubmit={handleActivate} className="license-input-row">
                <input 
                  type="text" 
                  className="license-input"
                  placeholder="VD: SOLO-270101-A3F7-1B2C3D4E"
                  spellCheck="false" 
                  autoComplete="off"
                  value={key}
                  onChange={e => setKey(e.target.value)}
                  disabled={loading}
                />
                <button type="submit" className="btn-license-activate" disabled={loading}>
                  {loading ? 'Đang kích hoạt...' : 'Kích hoạt'}
                </button>
              </form>

              <div className="license-tiers">
                <div className="tier-card">
                  <span className="tier-badge solo">SOLO</span>
                  <span>1 người dùng đồng thời</span>
                </div>
                <div className="tier-card">
                  <span className="tier-badge team">TEAM</span>
                  <span>5 người dùng đồng thời</span>
                </div>
                <div className="tier-card">
                  <span className="tier-badge ent">ENTERPRISE</span>
                  <span>Không giới hạn</span>
                </div>
              </div>
            </div>
          )}

          <div className="license-actions">
            <button className="btn-license-skip" onClick={() => navigate('/dashboard')}>
              Vào hệ thống (Chế độ demo)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
