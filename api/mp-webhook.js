import { config } from './_lib/config.js';
import { getOrder, updateOrder } from './_lib/supabase.js';
import {
  getValidAccessToken,
  getPayment,
  isValidWebhookSignature,
  mapPaymentToOrder
} from './_lib/mercadopago.js';

/**
 * Webhook de Mercado Pago: la ÚNICA fuente de verdad del estado de un pago.
 *
 * El navegador nunca marca un pedido como pagado. Cuando Mercado Pago avisa,
 * consultamos el pago con nuestro token y recién ahí actualizamos el pipeline.
 * El ingreso en `finances` lo genera el trigger fn_sync_order_finance de la
 * base al pasar payment_status a 'approved'.
 *
 * Mercado Pago espera un 200/201 dentro de 22 segundos; si no, reintenta cada
 * 15 minutos. Por eso siempre respondemos 200 salvo firma inválida: un 500 por
 * un pedido inexistente nos dejaría reintentos infinitos.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Método no permitido.' });
  }

  const query = req.query || {};
  const body = req.body || {};

  const tipo = query.type || query.topic || body.type;
  const dataId = query['data.id'] || query.id || body?.data?.id;

  // Validación de firma. Sin MP_WEBHOOK_SECRET configurado rechazamos:
  // aceptar notificaciones sin verificar dejaría que cualquiera marque
  // pedidos como pagados con un simple POST.
  if (!config.mpWebhookSecret) {
    console.error('[mp-webhook] Falta MP_WEBHOOK_SECRET. Notificación descartada.');
    return res.status(503).json({ ok: false, error: 'Webhook sin secreto configurado.' });
  }

  const firmaValida = isValidWebhookSignature({
    xSignature: req.headers['x-signature'],
    xRequestId: req.headers['x-request-id'],
    dataId
  });

  if (!firmaValida) {
    console.warn('[mp-webhook] Firma inválida. Notificación rechazada.');
    return res.status(401).json({ ok: false, error: 'Firma inválida.' });
  }

  // Solo nos interesan los avisos de pago.
  if (tipo !== 'payment') {
    return res.status(200).json({ ok: true, ignorado: tipo || 'desconocido' });
  }

  if (!dataId) {
    return res.status(200).json({ ok: true, ignorado: 'sin data.id' });
  }

  try {
    const token = await getValidAccessToken();
    const payment = await getPayment(dataId, token);

    const orderId = payment.external_reference || payment.metadata?.order_id;
    if (!orderId) {
      console.warn(`[mp-webhook] Pago ${dataId} sin external_reference.`);
      return res.status(200).json({ ok: true, ignorado: 'sin pedido asociado' });
    }

    const order = await getOrder(orderId);
    if (!order) {
      console.warn(`[mp-webhook] Pedido ${orderId} inexistente.`);
      return res.status(200).json({ ok: true, ignorado: 'pedido inexistente' });
    }

    const patch = mapPaymentToOrder(payment, order);
    if (!patch) {
      return res.status(200).json({ ok: true, ignorado: `estado ${payment.status}` });
    }

    // Idempotencia: Mercado Pago reenvía la misma notificación varias veces.
    // Si nada cambia no escribimos, así el trigger de finanzas no se re-dispara
    // y el panel no recibe eventos de realtime redundantes.
    const sinCambios = Object.entries(patch).every(([k, v]) => order[k] === v);
    if (sinCambios) {
      return res.status(200).json({ ok: true, sinCambios: true });
    }

    await updateOrder(orderId, patch);
    console.log(`[mp-webhook] Pedido ${orderId}: ${payment.status} -> ${patch.status || order.status}`);

    return res.status(200).json({ ok: true, pedido: orderId, estado: patch.status || order.status });
  } catch (err) {
    console.error('[mp-webhook]', err);
    // 500 solo en fallas nuestras, para que Mercado Pago reintente.
    return res.status(500).json({ ok: false, error: err.message });
  }
}
