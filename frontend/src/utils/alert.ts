// ============================================================
// alert.ts — Ghi đè (override) window.alert mặc định của trình duyệt
// Hiển thị một modal đẹp ở giữa màn hình thay vì popup mặc định
// ============================================================

export function setupCustomAlert() {
  window.alert = function (message: string) {
    // Tạo màng sẫm màu phía sau (backdrop)
    const backdrop = document.createElement('div');
    backdrop.style.cssText = `
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0, 0, 0, 0.6);
      backdrop-filter: blur(4px);
      z-index: 100000;
      display: flex;
      align-items: center;
      justify-content: center;
      animation: fadeIn 0.2s ease;
    `;

    // Tạo hộp thoại ở giữa (modal content)
    const modal = document.createElement('div');
    modal.style.cssText = `
      background: var(--admin-card-bg, #1a2235);
      border: 1px solid var(--admin-border, #2a344a);
      border-radius: 8px;
      padding: 24px;
      min-width: 320px;
      max-width: 90%;
      box-shadow: 0 10px 25px rgba(0, 0, 0, 0.5);
      display: flex;
      flex-direction: column;
      gap: 16px;
      animation: slideUp 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
    `;

    // Tiêu đề
    const title = document.createElement('h3');
    title.textContent = 'Thông báo hệ thống';
    title.style.cssText = `
      margin: 0;
      color: var(--admin-text, #fff);
      font-size: 1.1rem;
      font-weight: 700;
      font-family: Consolas, monospace;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    `;

    // Nội dung
    const text = document.createElement('div');
    text.textContent = message;
    text.style.cssText = `
      color: var(--admin-text-muted, #94a3b8);
      font-size: 0.95rem;
      line-height: 1.5;
    `;

    // Nút đóng
    const btnContainer = document.createElement('div');
    btnContainer.style.cssText = `
      display: flex;
      justify-content: flex-end;
      margin-top: 8px;
    `;
    const btn = document.createElement('button');
    btn.textContent = 'Xác nhận';
    btn.style.cssText = `
      background: var(--admin-accent, #3b82f6);
      color: #fff;
      border: none;
      padding: 8px 16px;
      border-radius: 4px;
      font-weight: 600;
      cursor: pointer;
      font-family: Consolas, monospace;
      transition: opacity 0.2s;
    `;
    btn.onmouseover = () => btn.style.opacity = '0.8';
    btn.onmouseout = () => btn.style.opacity = '1';

    // Đóng modal khi bấm nút
    const close = () => {
      backdrop.style.animation = 'fadeOut 0.2s ease forwards';
      modal.style.animation = 'slideDown 0.2s ease forwards';
      setTimeout(() => backdrop.remove(), 200);
    };

    btn.onclick = close;
    backdrop.onclick = (e) => {
      if (e.target === backdrop) close();
    };

    // Lắp ráp
    btnContainer.appendChild(btn);
    modal.appendChild(title);
    modal.appendChild(text);
    modal.appendChild(btnContainer);
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);

    // Focus vào nút xác nhận
    btn.focus();
  };

  // Thêm CSS animations vào thẻ style
  if (!document.getElementById('custom-alert-animations')) {
    const style = document.createElement('style');
    style.id = 'custom-alert-animations';
    style.innerHTML = `
      @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
      @keyframes fadeOut { from { opacity: 1; } to { opacity: 0; } }
      @keyframes slideUp { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
      @keyframes slideDown { from { transform: translateY(0); opacity: 1; } to { transform: translateY(20px); opacity: 0; } }
    `;
    document.head.appendChild(style);
  }
}
