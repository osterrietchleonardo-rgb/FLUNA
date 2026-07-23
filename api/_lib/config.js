/**
 * Configuración central de las serverless functions.
 * Los archivos y carpetas de /api que empiezan con "_" no se publican como
 * endpoints: son módulos internos.
 */

export const config = {
  supabaseUrl: process.env.SUPABASE_URL || process.env.PROJECT_URL || '',
  // SERVICE_ROLE_SECRET es el nombre que usa el .env original del proyecto.
  supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_SECRET || '',
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY || process.env.PUBLISHABLE_KEY || '',

  // Se aceptan los nombres cortos (CLIENT_ID/CLIENT_SECRET) por compatibilidad
  // con el .env original del proyecto.
  mpClientId: process.env.MP_CLIENT_ID || process.env.CLIENT_ID || '',
  mpClientSecret: process.env.MP_CLIENT_SECRET || process.env.CLIENT_SECRET || '',
  mpWebhookSecret: process.env.MP_WEBHOOK_SECRET || '',

  // Secreto para firmar el `state` del OAuth. La service role key siempre
  // está presente y nunca sale del servidor, así que sirve de clave HMAC.
  sessionSecret:
    process.env.ADMIN_SESSION_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SERVICE_ROLE_SECRET ||
    '',

  // PKCE en el OAuth de Mercado Pago. Activar SOLO después de habilitarlo en
  // "Detalles de aplicación" en el panel de Mercado Pago: si se manda
  // code_challenge sin haberlo habilitado allá, la autorización falla.
  mpPkce: /^(1|true|on|si|sí)$/i.test(process.env.MP_PKCE || ''),

  // Comisión del marketplace, en porcentaje del total del pedido.
  // Solo tiene efecto con tokens obtenidos por OAuth (cuenta de terceros).
  marketplaceFeePercent: Number(process.env.MP_MARKETPLACE_FEE_PERCENT || 0)
};

/** URL pública del deploy, para armar redirect_uri y notification_url. */
export function publicBaseUrl(req) {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/$/, '');

  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || 'https';
  return `${proto}://${host}`;
}

/** Falla temprano y con un mensaje claro si falta configuración. */
export function requireConfig(keys) {
  const missing = keys.filter(k => !config[k]);
  if (missing.length > 0) {
    const names = {
      supabaseUrl: 'SUPABASE_URL',
      supabaseServiceKey: 'SUPABASE_SERVICE_ROLE_KEY',
      mpClientId: 'MP_CLIENT_ID',
      mpClientSecret: 'MP_CLIENT_SECRET',
      mpWebhookSecret: 'MP_WEBHOOK_SECRET',
      sessionSecret: 'ADMIN_SESSION_SECRET'
    };
    const faltantes = missing.map(k => names[k] || k).join(', ');
    const error = new Error(`Falta configurar en Vercel: ${faltantes}`);
    error.statusCode = 503;
    throw error;
  }
}
