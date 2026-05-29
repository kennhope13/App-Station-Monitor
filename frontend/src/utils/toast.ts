// ============================================================
// toast.ts — Thông báo popup mượt mà
// Dùng: showToast('Lưu thành công', 'success')
// ============================================================

type ToastType = 'success' | 'error' | 'info';

const TOAST_DURATION = 3500;

const ICONS = {
  success: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>`,
  error: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
  info: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`
};

export function showToast(msg: string, type: ToastType = 'info'): void {
  // 1. UI Toast (Container)
  let container = document.getElementById('toastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toastContainer';
    // Đảm bảo thông báo xuất hiện ở phía TRÊN bên phải như yêu cầu
    Object.assign(container.style, {
      position: 'fixed',
      top: '20px',
      right: '20px',
      zIndex: '100010',
      display: 'flex',
      flexDirection: 'column',
      gap: '10px',
      pointerEvents: 'none'
    });
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `st-notification ${type}`;
  
  toast.innerHTML = `
    <div class="st-notification-icon">${ICONS[type]}</div>
    <div class="st-notification-content">${msg}</div>
  `;

  container.appendChild(toast);

  // Auto remove
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(20px) scale(0.9)';
    setTimeout(() => toast.remove(), 300);
  }, TOAST_DURATION);
}
