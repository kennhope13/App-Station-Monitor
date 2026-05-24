// ============================================================
// LoginPage.tsx — Trang đăng nhập
// Gọi authService.login() → lưu JWT vào localStorage
// Nếu license hết hạn → chuyển sang /license thay vì /dashboard
// ============================================================

import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { authService } from '@/services/AuthService';
import './LoginPage.css';

export default function LoginPage() {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [isShaking, setIsShaking] = useState(false); // animation lắc form khi sai mật khẩu

  const usernameRef = useRef<HTMLInputElement>(null);

  // Focus vào ô tên đăng nhập ngay khi trang tải
  useEffect(() => {
    usernameRef.current?.focus();
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) return;

    setLoading(true);
    setErrorMsg('');
    setIsShaking(false);

    // Delay 600ms để tránh cảm giác phản hồi quá nhanh (UX)
    await new Promise(r => setTimeout(r, 600));

    const result = await authService.login(username.trim(), password);

    setLoading(false);

    if (result.success) {
      const lr = result.licenseReason;
      // Backend trả licenseReason khi license không hợp lệ
      if (lr === 'no_license' || lr === 'expired') {
        navigate('/license');
      } else {
        navigate('/dashboard');
      }
    } else {
      setErrorMsg(result.error || 'Đăng nhập thất bại');
      setIsShaking(true);
      // Reset class shake sau khi animation kết thúc (400ms)
      setTimeout(() => setIsShaking(false), 400);
    }
  };

  return (
    <div className="gm-login-wrapper">
      <div className="gm-overlay"></div>
      <div className="gm-glass-panel">
        <img src="/favico/logo.svg" alt="Station Monitor Logo" className="gm-logo" />
        <h2>Hệ Thống Giám Sát</h2>
        <p className="gm-slogan">"Giám sát liên tục — Phát hiện sớm — Cảnh báo đúng lúc"</p>

        {errorMsg && (
          <div className={`gm-error ${isShaking ? 'shake' : ''}`}>
            ️ {errorMsg}
          </div>
        )}

        <form onSubmit={handleLogin} autoComplete="off">
          <div className="gm-input-group">
            <label htmlFor="loginUsername">Tên đăng nhập</label>
            <input 
              ref={usernameRef}
              type="text" 
              id="loginUsername" 
              placeholder="Ví dụ: admin" 
              required
              value={username}
              onChange={e => setUsername(e.target.value)}
              disabled={loading}
            />
          </div>
          <div className="gm-input-group">
            <label htmlFor="loginPassword">Mật khẩu</label>
            <div className="gm-pw-wrap">
              <input 
                type={showPassword ? 'text' : 'password'} 
                id="loginPassword" 
                placeholder="••••••••" 
                required
                value={password}
                onChange={e => setPassword(e.target.value)}
                disabled={loading}
              />
              <button 
                type="button" 
                className="gm-eye-btn" 
                title="Hiện/Ẩn mật khẩu"
                onClick={() => setShowPassword(!showPassword)}
                disabled={loading}
              >
                {showPassword ? (
                  // eye-off icon
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                    <line x1="1" y1="1" x2="23" y2="23"/>
                  </svg>
                ) : (
                  // eye icon
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                    <circle cx="12" cy="12" r="3"/>
                  </svg>
                )}
              </button>
            </div>
          </div>
          <button type="submit" className="gm-btn-login" disabled={loading}>
            {loading ? (
              <>
                <span>ĐANG ĐĂNG NHẬP...</span>
                <span>⏳</span>
              </>
            ) : (
              <span>ĐĂNG NHẬP</span>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
