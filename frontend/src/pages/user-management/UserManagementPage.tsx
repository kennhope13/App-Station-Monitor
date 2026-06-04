// ============================================================
// UserManagementPage.tsx — Quản lý tài khoản người dùng
// Vai trò: operator (xem + ack) | manager (+ báo cáo) | admin (toàn quyền)
// Chức năng: thêm/sửa tài khoản, đổi mật khẩu, vô hiệu hóa
// ============================================================

import { useState, useEffect } from 'react';
import { stationApi, UserItem } from '@/services/StationApiService';
import { confirmDialog } from '@/utils/confirm';

export default function UserManagementPage() {
  const [users, setUsers] = useState<UserItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Modals state
  const [isUserModalOpen, setIsUserModalOpen] = useState(false);
  const [isPwModalOpen, setIsPwModalOpen] = useState(false);
  
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  
  // Form State
  const [formData, setFormData] = useState({
    username: '', fullName: '', email: '',
    password: '', confirmPassword: '',
    role: 'operator', isActive: true
  });
  
  // Password change state
  const [pwData, setPwData] = useState({ newPassword: '', confirmPassword: '' });

  useEffect(() => {
    loadUsers();
  }, []);

  const loadUsers = async () => {
    setLoading(true);
    try {
      const data = await stationApi.getUsers();
      setUsers(data);
    } catch (e) {
      console.error('Lỗi tải danh sách người dùng:', e);
      alert('Lỗi tải danh sách người dùng');
    } finally {
      setLoading(false);
    }
  };

  const openAddModal = () => {
    setEditingUserId(null);
    setFormData({
      username: '', fullName: '', email: '',
      password: '', confirmPassword: '',
      role: 'operator', isActive: true
    });
    setIsUserModalOpen(true);
  };

  const openEditModal = (u: UserItem) => {
    setEditingUserId(u.id);
    setFormData({
      username: u.username, fullName: u.fullName || '', email: u.email || '',
      password: '', confirmPassword: '',
      role: u.role, isActive: u.isActive
    });
    setIsUserModalOpen(true);
  };

  const openPwModal = (id: string) => {
    setEditingUserId(id);
    setPwData({ newPassword: '', confirmPassword: '' });
    setIsPwModalOpen(true);
  };

  const saveUser = async () => {
    const { username, fullName, email, password, confirmPassword, role, isActive } = formData;
    
    if (editingUserId) {
      // Edit mode
      try {
        await stationApi.updateUser(editingUserId, { fullName, email, role, isActive });
        alert('Cập nhật tài khoản thành công');
        setIsUserModalOpen(false);
        loadUsers();
      } catch (e: any) {
        alert(`Lỗi: ${e.message}`);
      }
    } else {
      // Add mode
      if (!username) { alert('Vui lòng nhập tên đăng nhập'); return; }
      if (password !== confirmPassword) { alert('Mật khẩu xác nhận không khớp'); return; }
      if (password.length < 6) { alert('Mật khẩu phải ít nhất 6 ký tự'); return; }

      try {
        await stationApi.createUser({ username, password, fullName, email, role });
        alert(`Đã thêm tài khoản "${username}" thành công`);
        setIsUserModalOpen(false);
        loadUsers();
      } catch (e: any) {
        alert(`Lỗi: ${e.message}`);
      }
    }
  };

  const changePassword = async () => {
    if (!editingUserId) return;
    if (pwData.newPassword !== pwData.confirmPassword) { alert('Mật khẩu xác nhận không khớp'); return; }
    if (pwData.newPassword.length < 6) { alert('Mật khẩu phải ít nhất 6 ký tự'); return; }

    try {
      await stationApi.changePassword(editingUserId, { newPassword: pwData.newPassword });
      alert('Đổi mật khẩu thành công');
      setIsPwModalOpen(false);
    } catch (e: any) {
      alert(`Lỗi: ${e.message}`);
    }
  };

  const deactivateUser = async (u: UserItem) => {
    if (!await confirmDialog({ title: 'Vô hiệu hóa tài khoản', message: `Vô hiệu hóa tài khoản "${u.username}"?`, confirmText: 'Vô hiệu hóa', danger: true })) return;
    try {
      await stationApi.deactivateUser(u.id);
      alert(`Đã vô hiệu hóa tài khoản "${u.username}"`);
      loadUsers();
    } catch (e: any) {
      alert(`Lỗi: ${e.message}`);
    }
  };

  return (
    <div className="admin-page-container">
      <div className="page-toolbar-row">
        <div className="page-title-cell">
          <h2>NGƯỜI DÙNG</h2>
        </div>
        <div className="page-toolbar-group">
          <button 
            className="btn-industrial btn-primary" 
            style={{ height: 32, padding: '0 16px', fontSize: '.75rem', fontWeight: 800 }}
            onClick={openAddModal}
          >
            + THÊM TÀI KHOẢN
          </button>
        </div>
      </div>
      
      <div className="admin-card" style={{ padding: 0, overflow: 'auto', flexShrink: 0 }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Họ tên</th>
              <th>Tên đăng nhập</th>
              <th>Email</th>
              <th>Vai trò</th>
              <th>Trạng thái</th>
              <th>Hành động</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--admin-text-muted)', padding: 32 }}>⏳ Đang tải...</td></tr>
            ) : users.length === 0 ? (
              <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--admin-text-muted)', padding: 32 }}>Chưa có người dùng nào</td></tr>
            ) : (
              users.map(u => {
                const roleColor = u.role === 'admin' ? 'var(--admin-danger)' : u.role === 'manager' ? 'var(--admin-warning)' : 'var(--admin-success)';
                const roleLabel = u.role === 'admin' ? 'ADMIN' : u.role === 'manager' ? 'MANAGER' : 'OPERATOR';
                return (
                  <tr key={u.id}>
                    <td><b>{u.fullName || '—'}</b></td>
                    <td><code>{u.username}</code></td>
                    <td>{u.email || '—'}</td>
                    <td><span className="tag" style={{ background: `${roleColor}20`, color: roleColor }}>{roleLabel}</span></td>
                    <td>{u.isActive ? <span className="tag tag-success">Hoạt động</span> : <span className="tag tag-danger">Vô hiệu</span>}</td>
                    <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <button className="btn-industrial btn-sm" onClick={() => openEditModal(u)} title="Sửa thông tin">Sửa</button>
                      <button className="btn-industrial btn-sm" onClick={() => openPwModal(u.id)} title="Đổi mật khẩu">Đổi MK</button>
                      {u.isActive && <button className="btn-industrial btn-sm btn-danger" onClick={() => deactivateUser(u)} title="Vô hiệu hóa">Vô hiệu</button>}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="admin-card" style={{ padding: 20, marginTop: 16 }}>
        <div style={{ fontSize: '0.78rem', fontWeight: 800, color: 'var(--admin-text)', marginBottom: 12, textTransform: 'uppercase', fontFamily: 'Consolas, monospace', letterSpacing: '0.5px' }}>BẢNG PHÂN QUYỀN HỆ THỐNG</div>
        <table className="data-table">
          <thead>
            <tr>
              <th>Tính năng</th>
              <th style={{ textAlign: 'center' }}>Operator</th>
              <th style={{ textAlign: 'center' }}>Manager</th>
              <th style={{ textAlign: 'center' }}>Admin</th>
            </tr>
          </thead>
          <tbody>
            {[
              ['Xem Dashboard', '✓', '✓', '✓'],
              ['Acknowledge Alarm', '✓', '✓', '✓'],
              ['Xem báo cáo', '✓', '✓', '✓'],
              ['Tạo & Gửi báo cáo', '—', '✓', '✓'],
              ['Cấu hình ngưỡng', '—', '—', '✓'],
              ['Quản lý thiết bị', '—', '—', '✓'],
              ['Quản lý người dùng', '—', '—', '✓'],
              ['Xem Audit Log', '—', '✓', '✓'],
              ['Cài đặt hệ thống', '—', '—', '✓'],
            ].map((row, i) => (
              <tr key={i}>
                <td>{row[0]}</td>
                <td style={{ textAlign: 'center', color: row[1] === '✓' ? 'var(--admin-success)' : 'var(--admin-text-muted)', fontWeight: row[1] === '✓' ? 'bold' : 'normal' }}>{row[1]}</td>
                <td style={{ textAlign: 'center', color: row[2] === '✓' ? 'var(--admin-success)' : 'var(--admin-text-muted)', fontWeight: row[2] === '✓' ? 'bold' : 'normal' }}>{row[2]}</td>
                <td style={{ textAlign: 'center', color: row[3] === '✓' ? 'var(--admin-success)' : 'var(--admin-text-muted)', fontWeight: row[3] === '✓' ? 'bold' : 'normal' }}>{row[3]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* MODAL USER FORM */}
      {isUserModalOpen && (
        <div className="modal-overlay active">
          <div className="modal-content" style={{ width: 520 }}>
            <div className="modal-header">
              <h3>{editingUserId ? `SỬA TÀI KHOẢN — ${formData.username}` : 'THÊM TÀI KHOẢN'}</h3>
              <button className="modal-close-btn" onClick={() => setIsUserModalOpen(false)}>✕</button>
            </div>
            <div className="modal-body">
              {!editingUserId && (
                <div className="form-group">
                  <label>Tên đăng nhập <span style={{ color: 'var(--admin-danger)' }}>*</span></label>
                  <input type="text" className="form-input" placeholder="nguyen.va" value={formData.username} onChange={e => setFormData({ ...formData, username: e.target.value })} />
                </div>
              )}
              <div className="form-group"><label>Họ tên</label><input type="text" className="form-input" placeholder="Nguyễn Văn A" value={formData.fullName} onChange={e => setFormData({ ...formData, fullName: e.target.value })} /></div>
              <div className="form-group"><label>Email</label><input type="email" className="form-input" placeholder="user@station.vn" value={formData.email} onChange={e => setFormData({ ...formData, email: e.target.value })} /></div>
              
              {!editingUserId && (
                <div className="form-grid-2">
                  <div className="form-group"><label>Mật khẩu <span style={{ color: 'var(--admin-danger)' }}>*</span></label><input type="password" className="form-input" placeholder="••••••••" value={formData.password} onChange={e => setFormData({ ...formData, password: e.target.value })} /></div>
                  <div className="form-group"><label>Xác nhận mật khẩu</label><input type="password" className="form-input" placeholder="••••••••" value={formData.confirmPassword} onChange={e => setFormData({ ...formData, confirmPassword: e.target.value })} /></div>
                </div>
              )}
              
              <div className="form-group" style={{ marginTop: 8 }}>
                <label>Vai trò</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
                  <label className="checkbox-label"><input type="radio" name="role" value="operator" checked={formData.role === 'operator'} onChange={e => setFormData({ ...formData, role: e.target.value })} /> <b>Operator</b> <span style={{ color: 'var(--admin-text-muted)', marginLeft: 4 }}>– Xem + Acknowledge</span></label>
                  <label className="checkbox-label"><input type="radio" name="role" value="manager" checked={formData.role === 'manager'} onChange={e => setFormData({ ...formData, role: e.target.value })} /> <b>Manager</b> <span style={{ color: 'var(--admin-text-muted)', marginLeft: 4 }}>– Operator + Tạo báo cáo</span></label>
                  <label className="checkbox-label"><input type="radio" name="role" value="admin" checked={formData.role === 'admin'} onChange={e => setFormData({ ...formData, role: e.target.value })} /> <b>Admin</b> <span style={{ color: 'var(--admin-text-muted)', marginLeft: 4 }}>– Toàn quyền</span></label>
                </div>
              </div>

              {editingUserId && (
                <div className="form-group" style={{ marginTop: 8 }}>
                  <label className="checkbox-label">
                    <input type="checkbox" checked={formData.isActive} onChange={e => setFormData({ ...formData, isActive: e.target.checked })} /> Tài khoản đang hoạt động
                  </label>
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn-industrial" onClick={() => setIsUserModalOpen(false)}>Hủy</button>
              <button className="btn-industrial btn-primary" onClick={saveUser}>Lưu tài khoản</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL PASSWORD */}
      {isPwModalOpen && (
        <div className="modal-overlay active">
          <div className="modal-content" style={{ width: 420 }}>
            <div className="modal-header">
              <h3>ĐỔI MẬT KHẨU</h3>
              <button className="modal-close-btn" onClick={() => setIsPwModalOpen(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-group"><label>Mật khẩu mới <span style={{ color: 'var(--admin-danger)' }}>*</span></label><input type="password" className="form-input" placeholder="••••••••" value={pwData.newPassword} onChange={e => setPwData({ ...pwData, newPassword: e.target.value })} /></div>
              <div className="form-group"><label>Xác nhận mật khẩu mới</label><input type="password" className="form-input" placeholder="••••••••" value={pwData.confirmPassword} onChange={e => setPwData({ ...pwData, confirmPassword: e.target.value })} /></div>
            </div>
            <div className="modal-footer">
              <button className="btn-industrial" onClick={() => setIsPwModalOpen(false)}>Hủy</button>
              <button className="btn-industrial btn-primary" onClick={changePassword}>Đổi mật khẩu</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

