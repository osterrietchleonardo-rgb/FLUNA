import { config, publicBaseUrl } from './_lib/config.js';
import { getOrder } from './_lib/supabase.js';
import { getValidAccessToken, createPreference } from './_lib/mercadopago.js';

/**
 * Crea la preferencia de Checkout Pro para un pedido.
 *
 * REGLA CENTRAL: el navegador solo manda el `orderId`. Los importes, los items
 * y el total se leen de la base con la service role key. Si el monto viniera
 * del cliente, cualquiera podría pagar $1 una pizza de $9500.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Método no permitido. Utiliza POST.' });
  }

  const { orderId } = req.body || {};
  if (!orderId || typeof orderId !== 'string') {
    return res.status(400).json({ ok: false, error: 'Falta el identificador del pedido.' });
  }

  try {
    const order = await getOrder(orderId);
    if (!order) {
      return res.status(404).json({ ok: false, error: 'No encontramos ese pedido.' });
    }

    if (order.payment_status === 'approved') {
      return res.status(409).json({ ok: false, error: 'Este pedido ya está pago.' });
    }

    if (order.status === 'Cancelado') {
      return res.status(409).json({ ok: false, error: 'Este pedido fue cancelado.' });
    }

    const items = Array.isArray(order.order_items) ? order.order_items : [];
    if (items.length === 0) {
      return res.status(409).json({ ok: false, error: 'El pedido no tiene items para cobrar.' });
    }

    const token = await getValidAccessToken();
    const base = publicBaseUrl(req);

    // Los importes salen de order_items, no del cliente.
    const preferenceItems = items.map(item => ({
      id: String(item.product_id || item.id),
      title: String(item.product_name || 'Producto FLuna').slice(0, 250),
      quantity: Number(item.quantity),
      unit_price: Number(item.unit_price),
      currency_id: 'ARS'
    }));

    const totalCalculado = preferenceItems.reduce(
      (sum, i) => sum + i.unit_price * i.quantity, 0
    );

    // Si el total guardado no coincide con la suma de los items, algo se
    // desincronizó: preferimos no cobrar antes que cobrar un importe incorrecto.
    const totalGuardado = Number(order.total_amount);
    if (Math.abs(totalCalculado - totalGuardado) > 1) {
      console.error(`[create-preference] Descuadre en ${orderId}: items=${totalCalculado} orden=${totalGuardado}`);
      return res.status(409).json({
        ok: false,
        error: 'El total del pedido no coincide con su detalle. Contactanos antes de pagar.'
      });
    }

    const preference = {
      items: preferenceItems,
      external_reference: order.id,
      statement_descriptor: 'FLUNA',
      payer: {
        name: String(order.customer_name || '').slice(0, 100),
        email: order.customer_email || undefined
      },
      back_urls: {
        success: `${base}/index.html?pago=aprobado&pedido=${encodeURIComponent(order.id)}`,
        pending: `${base}/index.html?pago=pendiente&pedido=${encodeURIComponent(order.id)}`,
        failure: `${base}/index.html?pago=rechazado&pedido=${encodeURIComponent(order.id)}`
      },
      auto_return: 'approved',
      notification_url: `${base}/api/mp-webhook`,
      metadata: { order_id: order.id }
    };

    // Comisión del marketplace. Es un MONTO en pesos, no un porcentaje:
    // lo calculamos acá a partir de MP_MARKETPLACE_FEE_PERCENT.
    if (config.marketplaceFeePercent > 0) {
      preference.marketplace_fee = Math.round(totalCalculado * config.marketplaceFeePercent) / 100;
    }

    const created = await createPreference(preference, {
      token,
      // Reintentar el mismo pedido no duplica preferencias en Mercado Pago.
      idempotencyKey: `fluna-pref-${order.id}`
    });

    return res.status(200).json({
      ok: true,
      preferenceId: created.id,
      initPoint: created.init_point,
      sandboxInitPoint: created.sandbox_init_point
    });
  } catch (err) {
    console.error('[create-preference]', err);

    if (err.code === 'NOT_CONNECTED') {
      return res.status(409).json({
        ok: false,
        code: 'NOT_CONNECTED',
        error: 'El local todavía no conectó su cuenta de Mercado Pago. Elegí efectivo o transferencia.'
      });
    }

    return res.status(err.statusCode || 500).json({
      ok: false,
      error: err.message || 'No pudimos iniciar el pago.'
    });
  }
}
