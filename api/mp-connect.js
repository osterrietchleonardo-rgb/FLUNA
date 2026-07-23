import { config, publicBaseUrl } from './_lib/config.js';
import { rejectIfNotAdmin, signState, createPkcePair } from './_lib/admin-auth.js';
import { buildAuthorizationUrl } from './_lib/mercadopago.js';
import { savePendingOAuth } from './_lib/supabase.js';

/**
 * Devuelve la URL de autorización de Mercado Pago para que el panel redirija.
 *
 * Es POST y no un link directo a propósito: así el token de sesión viaja en
 * el header y nunca queda escrito en una URL (que termina en historiales,
 * logs de proxy y en el header Referer).
 *
 * El redirect_uri tiene que coincidir EXACTO con el configurado en
 * "URLs de redireccionamiento" de la aplicación en Mercado Pago:
 *   https://fluna.vercel.app/api/mp-callback
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Método no permitido. Utiliza POST.' });
  }

  if (await rejectIfNotAdmin(req, res)) return;

  try {
    const redirectUri = `${publicBaseUrl(req)}/api/mp-callback`;

    let pendingId = null;
    let pkce = null;

    if (config.mpPkce) {
      pkce = createPkcePair();
      const pending = await savePendingOAuth(pkce.verifier);
      if (!pending) throw new Error('No se pudo preparar la verificación PKCE.');
      pendingId = pending.id;
    }

    const url = buildAuthorizationUrl({
      redirectUri,
      state: signState({ pendingId }),
      codeChallenge: pkce?.challenge,
      codeChallengeMethod: pkce?.method
    });

    return res.status(200).json({ ok: true, url, pkce: config.mpPkce });
  } catch (err) {
    console.error('[mp-connect]', err);
    return res.status(err.statusCode || 500).json({ ok: false, error: err.message });
  }
}
