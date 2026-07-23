import crypto from 'node:crypto';
import { config } from './config.js';

/**
 * Autorización de administrador basada en Supabase Auth.
 *
 * El panel ya no se abre con una contraseña compartida: el dueño del local
 * inicia sesión con un usuario real de Supabase, marcado con
 * app_metadata.role = 'admin'. Ese mismo JWT es el que hace cumplir las
 * políticas RLS en la base, así que hay una sola identidad para todo.
 *
 * Acá validamos el token contra Supabase en vez de verificar la firma a mano:
 * así respetamos revocaciones y logout inmediatamente.
 */

/** Devuelve el usuario si el token es válido Y es admin. Si no, null. */
export async function getAdminUser(token) {
  if (!token || !config.supabaseUrl) return null;

  try {
    const res = await fetch(`${config.supabaseUrl}/auth/v1/user`, {
      headers: {
        apikey: config.supabaseAnonKey || config.supabaseServiceKey,
        Authorization: `Bearer ${token}`
      }
    });

    if (!res.ok) return null;

    const user = await res.json();
    const role = user?.app_metadata?.role;

    // Se lee de app_metadata a propósito: user_metadata lo puede editar el
    // propio usuario, así que no sirve para decidir permisos.
    return role === 'admin' ? user : null;
  } catch (err) {
    console.error('[admin-auth] No se pudo validar el token:', err.message);
    return null;
  }
}

export function bearerToken(req) {
  const header = req.headers['authorization'] || '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

/**
 * Corta la request si quien llama no es administrador.
 * Devuelve true si ya respondió (quien llama debe hacer return).
 */
export async function rejectIfNotAdmin(req, res) {
  const user = await getAdminUser(bearerToken(req));

  if (!user) {
    res.status(401).json({
      ok: false,
      error: 'Necesitás iniciar sesión como administrador.'
    });
    return true;
  }

  req.adminUser = user;
  return false;
}

// --- FIRMA DEL `state` DEL OAUTH ---

function sign(payload) {
  return crypto.createHmac('sha256', config.sessionSecret).update(payload).digest('base64url');
}

/**
 * `state` firmado: confirma en el callback que el flujo arrancó en nuestro
 * servidor (anti-CSRF) y transporta el id del registro PKCE pendiente.
 */
export function signState({ pendingId = null } = {}) {
  const payload = Buffer.from(JSON.stringify({
    n: crypto.randomBytes(8).toString('hex'),
    exp: Date.now() + 15 * 60 * 1000,
    pid: pendingId
  })).toString('base64url');

  return `${payload}.${sign(payload)}`;
}

/** Verifica el `state` y devuelve su contenido, o null si no es válido. */
export function readState(state) {
  if (!state || typeof state !== 'string' || !config.sessionSecret) return null;

  const [payload, signature] = state.split('.');
  if (!payload || !signature) return null;

  const expected = sign(payload);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (typeof data.exp !== 'number' || Date.now() >= data.exp) return null;
    return data;
  } catch {
    return null;
  }
}

// --- PKCE (RFC 7636) ---

/** Genera el par verifier/challenge para el flujo Authorization Code. */
export function createPkcePair() {
  // 43-128 caracteres. 32 bytes en base64url dan 43.
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge, method: 'S256' };
}
