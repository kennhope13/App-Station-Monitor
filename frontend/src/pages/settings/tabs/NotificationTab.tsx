// ============================================================
// NotificationTab.tsx — Tab "Thông báo"
// Cấu hình SMTP (host, port, user, pass, from) + gửi email test
// Settings keys: smtp_host, smtp_port, smtp_username, smtp_password, smtp_from
// ============================================================

import { useState, useEffect } from 'react';
import { stationApi } from '@/services/StationApiService';
import { showToast } from '@/utils/toast';

export default function NotificationTab() {
  const [smtpHost, setSmtpHost] = useState('smtp.gmail.com');
  const [smtpPort, setSmtpPort] = useState('587');
  const [smtpUser, setSmtpUser] = useState('');
  const [smtpPass, setSmtpPass] = useState('');
  const [smtpFrom, setSmtpFrom] = useState('');
  const [smtpSaveStatus, setSmtpSaveStatus] = useState('');

  const [testEmail, setTestEmail] = useState('');
  const [testEmailStatus, setTestEmailStatus] = useState('');
  const [sendingTest, setSendingTest] = useState(false);

  useEffect(() => {
    stationApi.getSmtpConfig()
      .then(cfg => {
        setSmtpHost(cfg.host || 'smtp.gmail.com');
        setSmtpPort(cfg.port || '587');
        setSmtpUser(cfg.username || '');
        setSmtpFrom(cfg.from || '');
      })
      .catch(() => {}); // SMTP config optional
  }, []);

  const handleSaveSmtp = async () => {
    setSmtpSaveStatus('Đang lưu...');
    try {
      const updates: Promise<any>[] = [
        stationApi.updateSetting('smtp_host', smtpHost),
        stationApi.updateSetting('smtp_port', smtpPort),
        stationApi.updateSetting('smtp_from', smtpFrom),
      ];
      if (smtpUser) updates.push(stationApi.updateSetting('smtp_username', smtpUser));
      if (smtpPass) updates.push(stationApi.updateSetting('smtp_password', smtpPass));
      await Promise.all(updates);
      setSmtpSaveStatus('Đã lưu SMTP');
      showToast('Lưu cấu hình SMTP thành công', 'success');
      setTimeout(() => setSmtpSaveStatus(''), 3000);
    } catch (e: any) {
      setSmtpSaveStatus(`Lỗi: ${e.message || e}`);
      showToast('Không thể lưu cấu hình SMTP', 'error');
    }
  };

  const handleSendTestEmail = async () => {
    if (!testEmail.trim()) { setTestEmailStatus('Nhập email trước'); return; }
    setSendingTest(true);
    setTestEmailStatus('');
    try {
      const res = await stationApi.sendTestEmail(testEmail.trim());
      setTestEmailStatus(res.message);
      showToast('Đã gửi email thử nghiệm', 'success');
    } catch (e: any) {
      setTestEmailStatus(e.message || String(e));
      showToast('Lỗi gửi email thử nghiệm', 'error');
    } finally {
      setSendingTest(false);
    }
  };

  return (
    <div>
      <div className="card-title">CẤU HÌNH THÔNG BÁO EMAIL</div>

      <div style={{ background: 'var(--admin-hover)', border: '1px solid var(--admin-border-light)', borderRadius: 0, padding: 16, marginBottom: 20 }}>
        <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--admin-text-muted)', marginBottom: 12, textTransform: 'uppercase' }}>Cấu hình SMTP</div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
          <div className="form-group" style={{ margin: 0 }}>
            <label htmlFor="s_smtp_host">SMTP HOST</label>
            <input id="s_smtp_host" type="text" className="form-input" placeholder="smtp.gmail.com"
              value={smtpHost} onChange={e => setSmtpHost(e.target.value)} />
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label htmlFor="s_smtp_port">PORT</label>
            <input id="s_smtp_port" type="number" className="form-input" style={{ width: 100 }} placeholder="587"
              value={smtpPort} onChange={e => setSmtpPort(e.target.value)} />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
          <div className="form-group" style={{ margin: 0 }}>
            <label htmlFor="s_smtp_user">USERNAME</label>
            <input id="s_smtp_user" type="text" className="form-input" placeholder="Username Mailtrap"
              value={smtpUser} onChange={e => setSmtpUser(e.target.value)} />
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label htmlFor="s_smtp_pass">PASSWORD</label>
            <input id="s_smtp_pass" type="password" className="form-input" placeholder="Password Mailtrap"
              value={smtpPass} onChange={e => setSmtpPass(e.target.value)} />
          </div>
        </div>

        <div className="form-group" style={{ margin: 0 }}>
          <label htmlFor="s_smtp_from">FROM (địa chỉ gửi)</label>
          <input id="s_smtp_from" type="text" className="form-input" style={{ width: 340 }}
            placeholder="StationMonitor <noreply@station.vn>"
            value={smtpFrom} onChange={e => setSmtpFrom(e.target.value)} />
        </div>

        <div style={{ marginTop: 14, padding: '10px 14px', background: 'var(--admin-info-bg)', border: '1px solid var(--admin-info-border)', borderRadius: 6, fontSize: '0.72rem', color: 'var(--admin-info-text)', lineHeight: 1.5 }}>
          <b>Dùng Gmail:</b> Host <code style={{ background: 'rgba(0,0,0,.2)', padding: '1px 4px', borderRadius: 3 }}>smtp.gmail.com</code> · Port <code style={{ background: 'rgba(0,0,0,.2)', padding: '1px 4px', borderRadius: 3 }}>587</code><br />
          Username = địa chỉ Gmail · Password = <b>App Password</b> (không phải mật khẩu Gmail thường).<br />
          Lấy App Password: <b>myaccount.google.com → Bảo mật → Xác minh 2 bước → Mật khẩu ứng dụng</b> → chọn "Thư" → tạo → copy mã 16 ký tự.
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 14, alignItems: 'center' }}>
          <button className="btn-industrial btn-primary" onClick={handleSaveSmtp}>Lưu SMTP</button>
          {smtpSaveStatus && (
            <span style={{ fontSize: '.82rem', color: smtpSaveStatus.startsWith('Lỗi') ? 'var(--admin-danger)' : 'var(--admin-success)' }}>
              {smtpSaveStatus}
            </span>
          )}
        </div>
      </div>

      <div style={{ background: 'var(--admin-hover)', border: '1px solid var(--admin-border-light)', borderRadius: 0, padding: 16 }}>
        <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--admin-text-muted)', marginBottom: 12, textTransform: 'uppercase' }}>Test gửi email</div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <input type="email" className="form-input" style={{ width: 280 }} placeholder="test@example.com"
            value={testEmail} onChange={e => setTestEmail(e.target.value)} />
          <button className="btn-industrial btn-primary" onClick={handleSendTestEmail} disabled={sendingTest}>
            {sendingTest ? 'Đang gửi...' : 'Gửi kiểm tra'}
          </button>
          {testEmailStatus && (
            <span style={{ fontSize: '.82rem', color: testEmailStatus.startsWith('Lỗi') ? 'var(--admin-danger)' : 'var(--admin-success)' }}>
              {testEmailStatus}
            </span>
          )}
        </div>
        <div style={{ fontSize: '0.72rem', color: 'var(--admin-text-muted)', marginTop: 8 }}>
          Nhập email để nhận thử. Email test sẽ vào Mailtrap Inbox (không gửi thật).
        </div>
      </div>
    </div>
  );
}
