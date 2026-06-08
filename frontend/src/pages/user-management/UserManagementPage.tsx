// ============================================================
// UserManagementPage.tsx — Quản lý tài khoản người dùng
// Vai trò: operator (xem + ack) | manager (+ báo cáo) | admin (toàn quyền)
// Chức năng: thêm/sửa tài khoản, đổi mật khẩu, vô hiệu hóa, phân quyền trạm
// ============================================================

import { useState, useEffect } from 'react';
import CentralTitleMenu from '@/components/CentralTitleMenu';
import { stationApi, UserItem, Station } from '@/services/StationApiService';
import { confirmDialog } from '@/utils/confirm';
import { authService } from '@/services/AuthService';

export default function UserManagementPage() {
  const currentUser = authService.getUser();
  const isRestrictedAdmin = currentUser?.station_ids && currentUser.station_ids.length > 0;
  const myStationIds: string[] = currentUser?.station_ids ?? [];

  const [users, setUsers] = useState<UserItem[]>([]);
  const [stationsList, setStationsList] = useState<Station[]>([]);
  const [loading, setLoading] = useState(true);

  // Modals state
  const [isUserModalOpen, setIsUserModalOpen] = useState(false);
  const [isPwModalOpen, setIsPwModalOpen] = useState(false);
  
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  
  // Form State
  const [formData, setFormData] = useState({
    username: '', fullName: '', email: '',
    password: '', confirmPassword: '',
    role: 'operator', isActive: true,
    stationIds: [] as string[]
  });
  
  // Password change state
  const [pwData, setPwData] = useState({ newPassword: '', confirmPassword: '' });

  useEffect(() => {
    loadUsers();
    loadStations();
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

  const loadStations = async () => {
    try {
      const data = await stationApi.getStations();
      setStationsList(data);
    } catch (e) {
      console.error('Lỗi tải danh sách trạm:', e);
    }
  };

  const openAddModal = () => {
    setEditingUserId(null);
    setFormData({
      username: '', fullName: '', email: '',
      password: '', confirmPassword: '',
      role: 'operator', isActive: true,
      stationIds: []
    });
    setIsUserModalOpen(true);
  };

  const openEditModal = (u: UserItem) => {
    setEditingUserId(u.id);
    setFormData({
      username: u.username, fullName: u.fullName || '', email: u.email || '',
      password: '', confirmPassword: '',
      role: u.role, isActive: u.isActive,
      stationIds: u.stationIds || []
    });
    setIsUserModalOpen(true);
  };

  const openPwModal = (id: string) => {
    setEditingUserId(id);
    setPwData({ newPassword: '', confirmPassword: '' });
    setIsPwModalOpen(true);
  };

  const saveUser = async () => {
    const { username, fullName, email, password, confirmPassword, role, isActive, stationIds } = formData;
    
    if (editingUserId) {
      // Edit mode
      try {
        await stationApi.updateUser(editingUserId, { fullName, email, role, isActive, stationIds });
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
        await stationApi.createUser({ username, password, fullName, email, role, stationIds });
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

  const getAssignedStationsText = (u: UserItem) => {
    if (u.stationIds && u.stationIds.length > 0) {
      const names = u.stationIds
        .map(id => stationsList.find(s => s.id === id)?.name || id.slice(0, 8))
        .join(', ');
      return names;
    }
    if (u.role === 'admin' || u.role === 'manager') {
      return 'Tất cả trạm';
    }
    return 'Tất cả trạm (mặc định)';
  };

  return (
    <div className="admin-page-container">
      <div className="page-toolbar-row">
        <div className="page-title-cell">
          <CentralTitleMenu title="NGƯỜI DÙNG" />
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
              <th>Họ tên & Phân quyền trạm</th>
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
                    <td>
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <b>{u.fullName || '—'}</b>
                        <span style={{ fontSize: 10, color: 'var(--admin-text-muted)', marginTop: 2 }}>
                          📍 {getAssignedStationsText(u)}
                        </span>
                      </div>
                    </td>
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
                  {/* Restricted admin chỉ tạo được admin có gán trạm (không tạo global admin) */}
                  <label className="checkbox-label"><input type="radio" name="role" value="admin" checked={formData.role === 'admin'} onChange={e => setFormData({ ...formData, role: e.target.value })} /> <b>Admin</b> <span style={{ color: 'var(--admin-text-muted)', marginLeft: 4 }}>– {isRestrictedAdmin ? 'Quản lý trạm' : 'Toàn quyền'}</span></label>
                </div>
              </div>

              {/* PHÂN QUYỀN TRẠM BIẾN ÁP */}
              {(() => {
                // Restricted admin: luôn hiển thị checkbox trạm (chỉ trạm của mình)
                // Global admin + operator: hiển thị khi role=operator
                // Global admin + manager/admin: ẩn (mặc định tất cả trạm)
                const showStationPicker = isRestrictedAdmin
                  ? (formData.role === 'operator' || formData.role === 'manager' || formData.role === 'admin')
                  : formData.role === 'operator';
                const visibleStations = isRestrictedAdmin
                  ? stationsList.filter(s => myStationIds.includes(s.id))
                  : stationsList;

                return (
                  <div className="form-group" style={{ marginTop: 12 }}>
                    <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span>Trạm biến áp được giám sát</span>
                      {!showStationPicker && (
                        <span style={{ fontSize: 9, color: 'var(--admin-success)', fontWeight: 800 }}>TẤT CẢ (Mặc định)</span>
                      )}
                    </label>

                    {showStationPicker ? (
                      <div style={{
                        maxHeight: 120, overflowY: 'auto', border: '1px solid var(--admin-border)',
                        padding: 8, marginTop: 4, display: 'flex', flexDirection: 'column', gap: 6,
                        background: 'var(--admin-layer-2)'
                      }} className="custom-hud-scroll">
                        {visibleStations.length === 0 ? (
                          <span style={{ fontSize: 11, color: 'var(--admin-text-muted)' }}>Chưa có trạm nào</span>
                        ) : (
                          visibleStations.map(s => {
                            const isChecked = formData.stationIds.includes(s.id);
                            return (
                              <label key={s.id} className="checkbox-label" style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={() => {
                                    const nextIds = isChecked
                                      ? formData.stationIds.filter(id => id !== s.id)
                                      : [...formData.stationIds, s.id];
                                    setFormData({ ...formData, stationIds: nextIds });
                                  }}
                                />
                                <span style={{ fontSize: 11 }}>{s.name} <code style={{ fontSize: 10, color: 'var(--admin-text-muted)' }}>({s.code})</code></span>
                              </label>
                            );
                          })
                        )}
                      </div>
                    ) : (
                      <div style={{
                        fontSize: 11, color: 'var(--admin-text-muted)', border: '1px dashed var(--admin-border)',
                        padding: '8px 10px', marginTop: 4, background: 'rgba(255,255,255,0.02)'
                      }}>
                        Tài khoản <b>{formData.role === 'admin' ? 'Quản trị viên' : 'Quản lý'}</b> mặc định được cấp quyền truy cập toàn bộ trạm biến áp trong hệ thống.
                      </div>
                    )}
                  </div>
                );
              })()}

              {editingUserId && (
                <div className="form-group" style={{ marginTop: 12 }}>
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
