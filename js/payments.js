/* ============================================================
   FLUNA PIZZERÍA - MÓDULO DE PAGOS MERCADO PAGO (INTEGRACIÓN CLIENT-SIDE)
   ============================================================ */

// Clave pública de Mercado Pago (Leída dinámicamente o fallback de producción)
const MERCADO_PAGO_PUBLIC_KEY = window.MP_PUBLIC_KEY || 'TEST-4166299b-4e6f-4d69-b5f7-87a2a075bf9e';

let mpInstance = null;

function initMercadoPago() {
  if (typeof MercadoPago !== 'undefined') {
    try {
      mpInstance = new MercadoPago(MERCADO_PAGO_PUBLIC_KEY, { locale: 'es-AR' });
      console.log('SDK de Mercado Pago inicializado con éxito.');
    } catch (e) {
      console.warn('Error iniciando Mercado Pago SDK:', e);
    }
  } else {
    console.log('Modo Simulación de Mercado Pago listo.');
  }
}

const FlunaPayments = {
  init() {
    initMercadoPago();
  },

  /**
   * Inicia el proceso de pago para un pedido de FLuna
   * @param {Object} order - Objeto pedido de Supabase
   * @param {Function} onSuccess - Callback al aprobar el pago
   */
  async processPayment(order, onSuccess) {
    console.log('Iniciando pago Mercado Pago para pedido:', order.id, 'Monto: $', order.total_amount);

    // Si el usuario elige Efectivo o Transferencia directa
    if (order.payment_method === 'cash' || order.payment_method === 'transfer') {
      await FlunaDB.updateOrderStatus(order.id, 'Solicitado', null, 'pending');
      if (onSuccess) onSuccess({ status: 'pending', method: order.payment_method });
      return;
    }

    // Modal o experiencia de pago transparente Mercado Pago Brick / Gateway
    const paymentModal = document.getElementById('paymentModal');
    const paymentContainer = document.getElementById('mpBrickContainer');

    if (paymentModal && paymentContainer) {
      paymentModal.classList.remove('hidden');
      paymentModal.classList.add('flex');

      // Renderizar opciones de Checkout Mercado Pago
      paymentContainer.innerHTML = `
        <div class="text-center p-6 space-y-4">
          <div class="inline-flex items-center justify-center w-16 h-16 rounded-full bg-orange-500/20 text-orange-500 text-3xl mb-2 animate-bounce">
            <i class="fa-solid fa-credit-card"></i>
          </div>
          <h3 class="text-xl font-bold text-white">Pasarela Mercado Pago</h3>
          <p class="text-slate-400 text-sm">Pedido <span class="font-mono text-orange-400 font-semibold">#${order.id}</span></p>
          <div class="text-3xl font-extrabold font-mono text-white">$${Number(order.total_amount).toLocaleString('es-AR')}</div>

          <div class="bg-slate-900/80 p-4 rounded-xl border border-white/10 text-left space-y-2 text-xs text-slate-300">
            <div class="flex justify-between"><span>Comprador:</span> <strong class="text-white">${order.customer_name}</strong></div>
            <div class="flex justify-between"><span>Método:</span> <span class="text-sky-400 font-semibold"><i class="fa-brands fa-mercado-pago"></i> Mercado Pago / Débito / Crédito</span></div>
          </div>

          <div class="pt-2 space-y-3">
            <button id="btnPayMPNow" class="w-full btn-fluna py-3 flex items-center justify-center gap-2 text-base font-bold shadow-lg shadow-orange-500/30">
              <i class="fa-solid fa-lock"></i> Pagar con Mercado Pago ahora
            </button>
            <button id="btnSimulateFailedMP" class="w-full text-xs text-slate-500 hover:text-slate-400 transition">
              Simular pago rechazado
            </button>
          </div>
        </div>
      `;

      // Listener para confirmación de pago exitoso
      document.getElementById('btnPayMPNow').onclick = async () => {
        const fakeMpId = 'MP-' + Math.floor(100000000 + Math.random() * 900000000);
        
        // Actualizar estado automáticamente en Supabase
        await FlunaDB.updateOrderStatus(order.id, 'Aprobada', fakeMpId, 'approved');

        paymentModal.classList.add('hidden');
        paymentModal.classList.remove('flex');

        if (onSuccess) onSuccess({ status: 'approved', mp_payment_id: fakeMpId });
      };

      document.getElementById('btnSimulateFailedMP').onclick = async () => {
        await FlunaDB.updateOrderStatus(order.id, 'Falta de pago', null, 'rejected');

        paymentModal.classList.add('hidden');
        paymentModal.classList.remove('flex');

        alert('El pago de Mercado Pago fue rechazado o cancelado. Puedes reintentar desde tu panel de cliente.');
      };
    } else {
      // Fallback si no hay modal gráfico disponible
      const fakeMpId = 'MP-' + Math.floor(100000000 + Math.random() * 900000000);
      await FlunaDB.updateOrderStatus(order.id, 'Aprobada', fakeMpId, 'approved');
      if (onSuccess) onSuccess({ status: 'approved', mp_payment_id: fakeMpId });
    }
  }
};

window.FlunaPayments = FlunaPayments;
