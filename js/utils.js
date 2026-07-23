/* ============================================================
   FLUNA PIZZERÍA - UTILIDADES COMPARTIDAS (UTILS.JS)
   Se carga antes que cualquier otro script de FLuna.
   ============================================================ */

const FlunaUtils = {
  /**
   * Escapa texto para insertarlo de forma segura dentro de innerHTML,
   * tanto en contenido como dentro de atributos entrecomillados.
   * Todo dato que venga de la base (nombres, direcciones, mensajes de chat,
   * notas del pedido) DEBE pasar por acá antes de interpolarse en un template.
   */
  escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  },

  /**
   * Sanea una URL de imagen: solo permite http(s) y data:image.
   * Evita que un `image_url` malicioso inyecte esquemas raros en el atributo src.
   */
  safeImageUrl(url, fallback = 'https://images.unsplash.com/photo-1513104890138-7c749659a591?w=600') {
    if (!url) return fallback;
    const clean = String(url).trim();
    if (/^https?:\/\//i.test(clean) || /^data:image\//i.test(clean)) {
      return this.escapeHtml(clean);
    }
    return fallback;
  },

  /** Formatea un monto en pesos argentinos, tolerando valores nulos o inválidos. */
  formatARS(value) {
    const n = Number(value);
    return '$' + (Number.isFinite(n) ? n : 0).toLocaleString('es-AR');
  },

  /** Convierte a número seguro (nunca NaN), para sumas y KPIs. */
  toNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  },

  /**
   * Genera un ID de pedido legible por teléfono (FL-123456).
   * El espacio es de 900.000 IDs; las colisiones residuales las resuelve
   * el reintento por conflicto de clave primaria en FlunaDB.createOrder().
   */
  generateOrderId() {
    return 'FL-' + Math.floor(100000 + Math.random() * 900000);
  },

  /** Formatea una hora corta tolerando fechas inválidas. */
  formatTime(value) {
    const d = new Date(value);
    if (isNaN(d.getTime())) return '--:--';
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  },

  /** Formatea una fecha corta tolerando fechas inválidas. */
  formatDate(value) {
    const d = new Date(value);
    if (isNaN(d.getTime())) return '--/--/----';
    return d.toLocaleDateString('es-AR');
  },

  /** Lee un JSON de localStorage sin romper si el contenido está corrupto. */
  readJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw);
      return parsed === null || parsed === undefined ? fallback : parsed;
    } catch (e) {
      console.warn(`[FLuna] localStorage "${key}" corrupto, se descarta.`, e);
      localStorage.removeItem(key);
      return fallback;
    }
  },

  /** Guarda un JSON en localStorage sin romper si la cuota está llena. */
  writeJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      console.warn(`[FLuna] No se pudo guardar "${key}" en localStorage.`, e);
      return false;
    }
  },

  /** Mensaje de error legible a partir de cualquier cosa que devuelva Supabase. */
  errorMessage(error, fallback = 'Ocurrió un error inesperado.') {
    if (!error) return fallback;
    if (typeof error === 'string') return error;
    return error.message || error.details || error.hint || fallback;
  },

  // --- TOASTS ---
  _toastStack: null,

  _getToastStack() {
    if (this._toastStack && document.body.contains(this._toastStack)) return this._toastStack;
    let stack = document.getElementById('flunaToastStack');
    if (!stack) {
      stack = document.createElement('div');
      stack.id = 'flunaToastStack';
      stack.className = 'toast-stack';
      stack.setAttribute('aria-live', 'polite');
      document.body.appendChild(stack);
    }
    this._toastStack = stack;
    return stack;
  },

  /**
   * Notificación no bloqueante.
   * @param {string} title - Título corto.
   * @param {string} message - Detalle opcional.
   * @param {'success'|'error'|'warning'|'info'} type
   * @param {number} duration - ms; 0 para que no se cierre solo.
   */
  toast(title, message = '', type = 'info', duration = 6000) {
    const iconos = {
      success: 'fa-circle-check',
      error: 'fa-circle-exclamation',
      warning: 'fa-triangle-exclamation',
      info: 'fa-bell'
    };

    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.setAttribute('role', type === 'error' ? 'alert' : 'status');
    el.innerHTML = `
      <i class="toast-icon fa-solid ${iconos[type] || iconos.info}"></i>
      <div class="toast-body">
        <div class="toast-title">${this.escapeHtml(title)}</div>
        ${message ? `<div class="toast-msg">${this.escapeHtml(message)}</div>` : ''}
      </div>
      <button class="toast-close" aria-label="Cerrar notificación">
        <i class="fa-solid fa-xmark"></i>
      </button>
    `;

    const cerrar = () => {
      if (!el.isConnected) return;
      el.classList.add('toast-out');
      setTimeout(() => el.remove(), 260);
    };

    el.querySelector('.toast-close').addEventListener('click', cerrar);

    const stack = this._getToastStack();
    stack.appendChild(el);

    // Nunca dejamos más de 5 apilados.
    while (stack.children.length > 5) stack.firstElementChild.remove();

    if (duration > 0) setTimeout(cerrar, duration);
    return el;
  },

  /** Sonido corto para avisos importantes (pago acreditado, pedido nuevo). */
  playChime() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.setValueAtTime(1180, ctx.currentTime + 0.12);
      gain.gain.setValueAtTime(0.14, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.42);
      osc.start();
      osc.stop(ctx.currentTime + 0.45);
      setTimeout(() => ctx.close().catch(() => {}), 800);
    } catch (e) {
      // El navegador puede bloquear audio sin interacción previa: no es crítico.
    }
  }
};

// Atajos globales de uso frecuente en los templates.
window.FlunaUtils = FlunaUtils;
window.esc = (value) => FlunaUtils.escapeHtml(value);
