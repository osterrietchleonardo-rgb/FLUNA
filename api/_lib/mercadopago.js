import crypto from 'node:crypto';
import { config, requireConfig } from './config.js';
import { getIntegration, saveIntegration } from './supabase.js';

const API = 'https://api.mercadopago.com';
export const AUTH_URL = 'https://auth.mercadopago.com/authorization';

async function mpFetch(path, { token, method = 'GET', body, idempotencyKey } = {}) {
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`
  };
  if (idempotencyKey) headers['X-Idempotency-Key'] = idempotencyKey;

  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(data.message || `Mercado Pago ${res.status}`);
    error.statusCode = res.status;
    error.details = data;
    throw error;
  }
  return data;
}

/**
 * URL a la que mandamos al vendedor para que autorice la aplicación.
 * Los parámetros de PKCE se agregan solo si MP_PKCE está activo: mandarlos
 * sin haber habilitado PKCE en el panel de Mercado Pago rompe el flujo.
 */
export function buildAuthorizationUrl({ redirectUri, state, codeChallenge, codeChallengeMethod }) {
  requireConfig(['mpClientId']);

  const params = new URLSearchParams({
    client_id: config.mpClientId,
    response_type: 'code',
    platform_id: 'mp',
    state,
    redirect_uri: redirectUri
  });

  if (codeChallenge) {
    params.set('code_challenge', codeChallenge);
    params.set('code_challenge_method', codeChallengeMethod || 'S256');
  }

  return `${AUTH_URL}?${params.toString()}`;
}

/**
 * Canjea el `code` (dura 10 minutos y es de un solo uso) por las credenciales
 * del vendedor. El access_token vive 180 días.
 */
export async function exchangeCodeForToken({ code, redirectUri, codeVerifier }) {
  requireConfig(['mpClientId', 'mpClientSecret']);

  const payload = {
    client_id: config.mpClientId,
    client_secret: config.mpClientSecret,
    code,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri
  };
  if (codeVerifier) payload.code_verifier = codeVerifier;

  const res = await fetch(`${API}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(data.message || data.error || `No se pudo canjear el código (${res.status})`);
    error.statusCode = res.status;
    throw error;
  }
  return data;
}

/**
 * Renueva el access_token antes de que venza.
 * OJO: cada renovación devuelve un refresh_token NUEVO. Si guardás el viejo,
 * la próxima renovación falla y el vendedor tiene que reconectar a mano.
 */
export async function refreshAccessToken(refreshToken) {
  requireConfig(['mpClientId', 'mpClientSecret']);

  const res = await fetch(`${API}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: config.mpClientId,
      client_secret: config.mpClientSecret,
      grant_type: 'refresh_token',
      refresh_token: refreshToken
    })
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(data.message || data.error || `No se pudo renovar el token (${res.status})`);
    error.statusCode = res.status;
    throw error;
  }
  return data;
}

export function integrationToRow(tokenResponse) {
  const expiresIn = Number(tokenResponse.expires_in || 0);
  return {
    mp_user_id: String(tokenResponse.user_id || ''),
    access_token: tokenResponse.access_token,
    refresh_token: tokenResponse.refresh_token || null,
    public_key: tokenResponse.public_key || null,
    live_mode: tokenResponse.live_mode !== false,
    scope: tokenResponse.scope || null,
    expires_at: expiresIn
      ? new Date(Date.now() + expiresIn * 1000).toISOString()
      : null,
    updated_at: new Date().toISOString()
  };
}

/**
 * Devuelve un access_token vigente, renovándolo si le quedan menos de 7 días.
 * Si el vendedor nunca conectó su cuenta, tira un error explicativo.
 */
export async function getValidAccessToken() {
  const integration = await getIntegration();

  if (!integration || !integration.access_token) {
    const error = new Error('El local todavía no conectó su cuenta de Mercado Pago.');
    error.statusCode = 409;
    error.code = 'NOT_CONNECTED';
    throw error;
  }

  const expiresAt = integration.expires_at ? new Date(integration.expires_at).getTime() : 0;
  const sieteDias = 7 * 24 * 60 * 60 * 1000;

  if (expiresAt && expiresAt - Date.now() < sieteDias && integration.refresh_token) {
    try {
      const refreshed = await refreshAccessToken(integration.refresh_token);
      const row = integrationToRow(refreshed);
      await saveIntegration(row);
      return row.access_token;
    } catch (err) {
      // Si la renovación falla seguimos con el token viejo mientras siga vivo.
      console.error('[MP] Falló la renovación del token:', err.message);
      if (expiresAt < Date.now()) throw err;
    }
  }

  return integration.access_token;
}

/** Crea la preferencia de Checkout Pro. */
export async function createPreference(preference, { token, idempotencyKey }) {
  return mpFetch('/checkout/preferences', {
    token,
    method: 'POST',
    body: preference,
    idempotencyKey
  });
}

/** Consulta un pago por ID. Es la fuente de verdad del estado. */
export async function getPayment(paymentId, token) {
  return mpFetch(`/v1/payments/${encodeURIComponent(paymentId)}`, { token });
}

/**
 * Valida la firma del webhook según el algoritmo oficial:
 *   manifest = "id:<data.id>;request-id:<x-request-id>;ts:<ts>;"
 *   HMAC-SHA256(manifest, secret) en hexadecimal == v1
 * Los valores ausentes se omiten del manifest.
 */
export function isValidWebhookSignature({ xSignature, xRequestId, dataId }) {
  if (!config.mpWebhookSecret) return false;
  if (!xSignature) return false;

  let ts, hash;
  for (const part of String(xSignature).split(',')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === 'ts') ts = value;
    if (key === 'v1') hash = value;
  }

  if (!ts || !hash) return false;

  const parts = [];
  if (dataId) parts.push(`id:${String(dataId).toLowerCase()}`);
  if (xRequestId) parts.push(`request-id:${xRequestId}`);
  parts.push(`ts:${ts}`);
  const manifest = parts.join(';') + ';';

  const computed = crypto.createHmac('sha256', config.mpWebhookSecret).update(manifest).digest('hex');

  const a = Buffer.from(computed);
  const b = Buffer.from(hash);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Traduce el estado del pago de Mercado Pago al pipeline de FLuna.
 * Devuelve null cuando el estado no debe tocar el pedido.
 */
export function mapPaymentToOrder(payment, currentOrder) {
  const status = payment.status;

  if (status === 'approved') {
    // No retrocedemos un pedido que la cocina ya avanzó.
    const yaAvanzado = ['En cocina', 'Terminado', 'Embalando', 'En camino', 'Entregado'];
    return {
      payment_status: 'approved',
      status: yaAvanzado.includes(currentOrder.status) ? currentOrder.status : 'Aprobada',
      mp_payment_id: String(payment.id)
    };
  }

  if (status === 'rejected' || status === 'cancelled') {
    return { payment_status: 'rejected', status: 'Falta de pago', mp_payment_id: String(payment.id) };
  }

  if (status === 'refunded' || status === 'charged_back') {
    return { payment_status: 'rejected', status: 'Cancelado', mp_payment_id: String(payment.id) };
  }

  if (status === 'pending' || status === 'in_process' || status === 'authorized') {
    return { payment_status: 'in_process', mp_payment_id: String(payment.id) };
  }

  return null;
}
