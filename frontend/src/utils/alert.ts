// ============================================================
// alert.ts — Ghi đè (override) window.alert mặc định
// Hiển thị một modal hiện đại, mượt mà theo phong cách StationOS
// ============================================================

const TOAST_CONTAINER_ID = 'st-toast-container';
const TOAST_LIFETIME = 5000; // 5 seconds

function createToastContainer() {
  let container = document.getElementById(TOAST_CONTAINER_ID);
  if (!container) {
    container = document.createElement('div');
    container.id = TOAST_CONTAINER_ID;
    document.body.appendChild(container);
  }
  return container;
}

export function setupCustomAlert() {
  window.alert = function (message: string) {
    const container = createToastContainer();
    
    const toast = document.createElement('div');
    toast.className = 'st-toast';

    let title = 'Hệ thống';
    let iconColor = 'var(--admin-accent-light)';
    const lowerMsg = message.toLowerCase();

    if (lowerMsg.includes('lỗi') || lowerMsg.includes('không thể') || lowerMsg.includes('thất bại')) {
      title = 'Cảnh báo lỗi';
      iconColor = '#ff4d4d';
    } else if (lowerMsg.includes('thành công') || lowerMsg.includes('đã lưu') || lowerMsg.includes(' ok')) {
      title = 'Thành công';
      iconColor = '#4ade80';
    } else if (lowerMsg.includes('vui lòng') || lowerMsg.includes('nhập')) {
      title = 'Yêu cầu';
      iconColor = '#fbbf24';
    }

    const iconSvg = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="${iconColor}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`;

    toast.innerHTML = `
      <div class="st-toast-icon">${iconSvg}</div>
      <div class="st-toast-content">
        <div class="st-toast-title" style="color: ${iconColor}">${title}</div>
        <div class="st-toast-body">${message}</div>
      </div>
      <button class="st-toast-close">&times;</button>
    `;

    container.appendChild(toast);

    // Animate in
    setTimeout(() => {
      toast.classList.add('visible');
    }, 10);

    const close = () => {
      toast.classList.remove('visible');
      setTimeout(() => {
        toast.remove();
        // If no more toasts, remove container to keep DOM clean.
        if (container.childElementCount === 0) {
            container.remove();
        }
      }, 400); // Match CSS transition
    };

    const closeButton = toast.querySelector('.st-toast-close') as HTMLButtonElement;
    closeButton.onclick = close;

    // Auto-dismiss after some time
    setTimeout(close, TOAST_LIFETIME);
  };
}
