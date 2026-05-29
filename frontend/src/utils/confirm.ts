// ============================================================
// confirmDialog — Custom confirm modal thay thế window.confirm
// Dùng: await confirmDialog({ message: '...', danger: true })
// ============================================================

export interface ConfirmOptions {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;       // true → nút xác nhận màu đỏ
}

// Singleton overlay — tạo một lần, tái sử dụng cho tất cả lần gọi
let _overlay: HTMLElement | null = null;

function ensureOverlay(): HTMLElement {
  if (_overlay && document.body.contains(_overlay)) return _overlay;

  _overlay = document.createElement('div');
  _overlay.id = 'custom-confirm-overlay';
  _overlay.innerHTML = `
    <div id="custom-confirm-box" style="
      background:var(--admin-card-bg, var(--admin-panel));border:1px solid var(--admin-border);border-radius:4px;
      box-shadow:0 20px 60px rgba(0,0,0,.3);padding:0;
      min-width:320px;max-width:420px;width:90%;overflow:hidden;
      font-family:inherit;
      transform:scale(0.92);transition:transform 0.15s ease;
    ">
      <div style="background:var(--admin-layer-1);padding:14px 20px;border-bottom:1px solid var(--admin-border);
        display:flex;align-items:center;gap:10px;">
        <span id="ccd-icon" style="font-size:1.2rem;display:flex;align-items:center;"></span>
        <span id="ccd-title" style="font-size:0.85rem;font-weight:800;color:var(--admin-text);font-family:inherit;"></span>
      </div>
      <div style="padding:18px 20px;">
        <p id="ccd-message" style="margin:0 0 20px;font-size:0.82rem;color:var(--admin-text-muted);line-height:1.6;font-family:inherit;"></p>
        <div style="display:flex;gap:10px;justify-content:flex-end;">
          <button id="ccd-cancel" style="
            padding:8px 18px;background:transparent;border:1px solid var(--admin-border);
            border-radius:4px;color:var(--admin-text-muted);font-size:0.78rem;font-weight:600;
            font-family:inherit;
            cursor:pointer;transition:all 0.15s;">
          </button>
          <button id="ccd-confirm" style="
            padding:8px 18px;border:none;border-radius:4px;
            font-size:0.78rem;font-weight:700;font-family:inherit;
            cursor:pointer;transition:all 0.15s;">
          </button>
        </div>
      </div>
    </div>
  `;
  Object.assign(_overlay.style, {
    position: 'fixed', inset: '0', zIndex: '999999',
    background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    opacity: '0', transition: 'opacity 0.15s ease',
  });
  document.body.appendChild(_overlay);
  return _overlay;
}

export function confirmDialog(opts: ConfirmOptions | string): Promise<boolean> {
  const options: ConfirmOptions = typeof opts === 'string' ? { message: opts } : opts;
  const {
    title       = options.danger ? 'Xác nhận xóa' : 'Xác nhận',
    message,
    confirmText = options.danger ? 'Xóa' : 'Xác nhận',
    cancelText  = 'Hủy',
    danger      = false,
  } = options;

  return new Promise(resolve => {
    const overlay = ensureOverlay();

    (overlay.querySelector('#ccd-icon')     as HTMLElement).textContent = danger ? '⚠️' : 'ℹ️';
    (overlay.querySelector('#ccd-title')    as HTMLElement).textContent = title;
    (overlay.querySelector('#ccd-message')  as HTMLElement).textContent = message;
    (overlay.querySelector('#ccd-cancel')   as HTMLElement).textContent = cancelText;

    const confirmBtn = overlay.querySelector('#ccd-confirm') as HTMLElement;
    confirmBtn.textContent = confirmText;
    Object.assign(confirmBtn.style, {
      background: danger ? 'var(--admin-danger)' : 'var(--admin-accent)',
      color: 'var(--admin-text-on-accent, #ffffff)',
    });

    // Animate in
    overlay.style.display = 'flex';
    requestAnimationFrame(() => {
      overlay.style.opacity = '1';
      (overlay.querySelector('#custom-confirm-box') as HTMLElement).style.transform = 'scale(1)';
    });

    const close = (result: boolean) => {
      overlay.style.opacity = '0';
      (overlay.querySelector('#custom-confirm-box') as HTMLElement).style.transform = 'scale(0.92)';
      setTimeout(() => { overlay.style.display = 'none'; }, 150);
      resolve(result);
    };

    // Clone node để xóa event listener cũ — tránh gọi callback sai khi mở lại
    const newCancel  = (overlay.querySelector('#ccd-cancel')  as HTMLElement).cloneNode(true) as HTMLElement;
    const newConfirm = (overlay.querySelector('#ccd-confirm') as HTMLElement).cloneNode(true) as HTMLElement;
    overlay.querySelector('#ccd-cancel')!.replaceWith(newCancel);
    overlay.querySelector('#ccd-confirm')!.replaceWith(newConfirm);

    newCancel.addEventListener('click',  () => close(false));
    newConfirm.addEventListener('click', () => close(true));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(false); }, { once: true });

    // Keyboard: Enter = confirm, Escape = cancel
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter')  { document.removeEventListener('keydown', onKey); close(true); }
      if (e.key === 'Escape') { document.removeEventListener('keydown', onKey); close(false); }
    };
    document.addEventListener('keydown', onKey);
  });
}
