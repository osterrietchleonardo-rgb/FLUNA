/* ============================================================
   FLUNA PIZZERÍA - PAGOS CON MERCADO PAGO (CHECKOUT PRO)

   Flujo real:
   1. El navegador pide /api/create-preference mandando SOLO el id del pedido.
   2. El servidor arma la preferencia leyendo los importes de la base.
   3. Se redirige al Checkout Pro de Mercado Pago.
   4. Mercado Pago notifica a /api/mp-webhook, que actualiza el pedido.

   El navegador nunca marca un pedido como pagado: eso lo decide el webhook.
   ============================================================ */

const FlunaPayments = {
  init() {
    // Checkout Pro es por redirección: no hace falta inicializar el SDK.
  },

  /** Muestra el modal de pago con un contenido dado. */
  _mostrarModal(html) {
    const modal = document.getElementById('paymentModal');
    const container = document.getElementById('mpBrickContainer');
    if (!modal || !container) return false;

    container.innerHTML = html;
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    return true;
  },

  _cerrarModal() {
    const modal = document.getElementById('paymentModal');
    if (!modal) return;
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  },

  /**
   * Inicia el pago de un pedido.
   * @param {Object} order - Pedido tal como quedó en Supabase.
   * @param {Function} onSuccess - Callback para métodos que no son Mercado Pago.
   */
  async processPayment(order, onSuccess) {
    // Efectivo y transferencia: el pedido queda pendiente de cobro en el local.
    if (order.payment_method === 'cash' || order.payment_method === 'transfer') {
      await FlunaDB.updateOrderStatus(order.id, 'Solicitado', null, 'pending');
      if (onSuccess) onSuccess({ status: 'pending', method: order.payment_method });
      return;
    }

    this._mostrarModal(`
      <div class="text-center p-8 space-y-4">
        <i class="fa-solid fa-spinner fa-spin text-3xl text-orange-500"></i>
        <h3 class="text-lg font-bold text-white">Preparando tu pago seguro</h3>
        <p class="text-xs text-slate-400">Te estamos llevando a Mercado Pago…</p>
      </div>
    `);

    try {
      const res = await fetch('/api/create-preference', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: order.id })
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.ok) {
        return this._mostrarError(order, data.error, data.code);
      }

      const destino = data.initPoint || data.sandboxInitPoint;
      if (!destino) {
        return this._mostrarError(order, 'Mercado Pago no devolvió un link de pago.');
      }

      // Redirección al Checkout Pro.
      window.location.href = destino;
    } catch (err) {
      console.error('Error iniciando el pago:', err);
      this._mostrarError(order, 'No pudimos conectarnos con Mercado Pago. Revisá tu conexión.');
    }
  },

  _mostrarError(order, mensaje, code) {
    const sinConexion = code === 'NOT_CONNECTED';

    this._mostrarModal(`
      <div class="text-center p-6 space-y-4">
        <div class="inline-flex items-center justify-center w-14 h-14 rounded-full bg-rose-500/20 text-rose-400 text-2xl">
          <i class="fa-solid fa-triangle-exclamation"></i>
        </div>
        <h3 class="text-lg font-bold text-white">No pudimos iniciar el pago</h3>
        <p class="text-xs text-slate-400 max-w-sm mx-auto">${esc(mensaje || 'Intentá de nuevo en unos minutos.')}</p>

        <div class="bg-slate-900/80 p-3 rounded-xl border border-white/10 text-left text-xs text-slate-300">
          Tu pedido <span class="font-mono text-orange-400 font-bold">#${esc(order.id)}</span> quedó registrado
          por ${FlunaUtils.formatARS(order.total_amount)}.
          ${sinConexion
            ? 'Podés coordinar el pago en efectivo o por transferencia al recibirlo.'
            : 'Podés reintentar el pago desde "Mis pedidos".'}
        </div>

        <button onclick="FlunaPayments._cerrarModal()" class="w-full btn-fluna py-3 text-sm font-bold">
          Entendido
        </button>
      </div>
    `);
  },

  /**
   * Reintento de pago desde el panel del cliente, para un pedido ya creado.
   */
  async retryPayment(orderId) {
    const order = (FlunaApp.state.customerOrders || []).find(o => o.id === orderId);
    if (!order) return;
    await this.processPayment({ ...order, payment_method: 'mercadopago' });
  }
};

window.FlunaPayments = FlunaPayments;
