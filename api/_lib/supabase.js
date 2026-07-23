import { config, requireConfig } from './config.js';

/**
 * Acceso a Supabase desde el servidor usando la SERVICE ROLE KEY.
 * Esa clave saltea RLS por completo: nunca puede llegar al navegador.
 * Solo se usa acá, dentro de /api.
 */
async function rest(path, options = {}) {
  requireConfig(['supabaseUrl', 'supabaseServiceKey']);

  const res = await fetch(`${config.supabaseUrl}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: config.supabaseServiceKey,
      Authorization: `Bearer ${config.supabaseServiceKey}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });

  const text = await res.text();
  let body = null;
  if (text) {
    try { body = JSON.parse(text); } catch { body = text; }
  }

  if (!res.ok) {
    const error = new Error(
      `Supabase ${res.status}: ${body?.message || body?.hint || text || 'error desconocido'}`
    );
    error.statusCode = res.status;
    throw error;
  }

  return body;
}

/** Pedido con sus items, o null si no existe. */
export async function getOrder(orderId) {
  const rows = await rest(
    `orders?id=eq.${encodeURIComponent(orderId)}&select=*,order_items(*)&limit=1`
  );
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
}

/** Actualiza un pedido y devuelve la fila resultante. */
export async function updateOrder(orderId, patch) {
  const rows = await rest(`orders?id=eq.${encodeURIComponent(orderId)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() })
  });
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
}

/**
 * Integración de Mercado Pago del local.
 * La tabla tiene RLS activo y ninguna política, así que solo es accesible
 * con la service role key. Los tokens jamás se exponen al panel.
 */
export async function getIntegration() {
  const rows = await rest('mp_integrations?select=*&order=updated_at.desc&limit=1');
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
}

export async function saveIntegration(data) {
  const existing = await getIntegration();

  if (existing) {
    const rows = await rest(`mp_integrations?id=eq.${existing.id}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ ...data, updated_at: new Date().toISOString() })
    });
    return Array.isArray(rows) ? rows[0] : null;
  }

  const rows = await rest('mp_integrations', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify([data])
  });
  return Array.isArray(rows) ? rows[0] : null;
}

export async function deleteIntegration() {
  await rest('mp_integrations?id=not.is.null', { method: 'DELETE' });
}

/**
 * PKCE: el `code_verifier` se guarda en el servidor entre el inicio del OAuth
 * y el callback. Guardarlo dentro del `state` no serviría, porque viaja por el
 * mismo canal que el `code` y PKCE justamente protege contra que alguien
 * intercepte ese canal.
 */
export async function savePendingOAuth(codeVerifier) {
  const rows = await rest('mp_oauth_pending', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify([{ code_verifier: codeVerifier }])
  });
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
}

/** Consume el verifier: lo lee y lo borra (es de un solo uso). */
export async function consumePendingOAuth(pendingId) {
  if (!pendingId) return null;

  const rows = await rest(`mp_oauth_pending?id=eq.${encodeURIComponent(pendingId)}&select=*&limit=1`);
  const row = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;

  if (row) {
    await rest(`mp_oauth_pending?id=eq.${encodeURIComponent(pendingId)}`, { method: 'DELETE' })
      .catch(err => console.warn('[oauth] No se pudo limpiar el pendiente:', err.message));
  }

  // Limpieza oportunista de intentos abandonados de más de una hora.
  const hace1h = new Date(Date.now() - 3600000).toISOString();
  rest(`mp_oauth_pending?created_at=lt.${hace1h}`, { method: 'DELETE' }).catch(() => {});

  return row;
}
