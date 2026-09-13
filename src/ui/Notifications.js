export class Notifications {
  static container = null;

  static init() {
    if (!this.container) {
      this.container = document.createElement('div');
      this.container.className = 'toast-container';
      document.body.appendChild(this.container);
    }
  }

  static show(message, type = 'info', duration = 3000) {
    this.init();

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    let iconClass = 'pixelart-icons-font-info-box';
    if (type === 'success') iconClass = 'pixelart-icons-font-sparkles';
    if (type === 'warning') iconClass = 'pixelart-icons-font-alert';
    if (type === 'error') iconClass = 'pixelart-icons-font-close-box';

    toast.innerHTML = `
      <span class="toast-icon"><i class="${iconClass}"></i></span>
      <span class="toast-text">${this.escapeHTML(message)}</span>
    `;

    this.container.appendChild(toast);

    // Fade in
    requestAnimationFrame(() => toast.classList.add('show'));

    // Auto remove
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 350);
    }, duration);
  }

  static escapeHTML(str) {
    return String(str || '').replace(/[&<>'"]/g, 
      tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
    );
  }
}
