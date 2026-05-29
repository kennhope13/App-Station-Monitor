// ============================================================
// toast.ts — Thông báo popup góc phải dưới màn hình
// Dùng: showToast('Lưu thành công', 'success')
// Tự động biến mất sau 3 giây
// ============================================================

type ToastType = 'success' | 'error' | 'info';

const TOAST_DURATION = 3000; // ms

export function showToast(msg: string, type: ToastType = 'info'): void {
  // Màu viền và chữ theo loại thông báo
  const color =
    type === 'success' ? 'var(--admin-success)' : type === 'error' ? 'var(--admin-danger)' : 'var(--admin-accent)';
  // Nền bán trong suốt cùng tông màu
  const bgColor =
    type === 'success'
      ? 'rgba(16, 185, 129, 0.1)'
      : type === 'error'
        ? 'rgba(239, 68, 68, 0.1)'
        : 'rgba(59, 130, 246, 0.1)';

  const toast = document.createElement('div');
  toast.style.cssText = `
    position: relative;
    padding: 12px 16px;
    background: ${bgColor};
    border: 1px solid ${color};
    backdrop-filter: blur(4px);
    border-radius: 8px;
    color: ${color};
    font-size: 14px;
    font-weight: 500;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    animation: toastIn 0.2s ease;
  `;
  toast.textContent = msg;

  // Tạo container một lần, tái dụng cho các toast tiếp theo
  if (!document.getElementById('toastContainer')) {
    const container = document.createElement('div');
    container.id = 'toastContainer';
    container.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      z-index: 10000;
      pointer-events: none;
    `;
    document.body.appendChild(container);
  }

  document.getElementById('toastContainer')!.appendChild(toast);

  // Fade out rồi xóa khỏi DOM
  setTimeout(() => {
    toast.style.animation = 'toastOut 0.2s ease';
    setTimeout(() => {
      toast.remove();
    }, 200);
  }, TOAST_DURATION);
}

