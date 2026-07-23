import { publicBaseUrl } from './_lib/config.js';
import { readState } from './_lib/admin-auth.js';
import { exchangeCodeForToken, integrationToRow } from './_lib/mercadopago.js';
import { saveIntegration, consumePendingOAuth } from './_lib/supabase.js';

/**
 * Vuelta del OAuth de Mercado Pago.
 * Canjea el `code` por las credenciales del vendedor, las guarda en
 * mp_integrations (tabla sin políticas RLS: solo la service role la ve) y
 * devuelve al panel con el resultado.
 */
function volverAlPanel(res, base, params) {
  const query = new URLSearchParams(params).toString();
  res.redirect(302, `${base}/admin_fluna?${query}`);
}

export default async function handler(req, res) {
  const base = publicBaseUrl(req);

  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Método no permitido.' });
  }

  const { code, state, error: oauthError, error_description: oauthDesc } = req.query || {};

  if (oauthError) {
    return volverAlPanel(res, base, {
      mp: 'error',
      motivo: oauthDesc || oauthError
    });
  }

  // El `state` firmado confirma que el flujo arrancó en nuestro panel (anti-CSRF).
  const stateData = readState(state);
  if (!stateData) {
    return volverAlPanel(res, base, {
      mp: 'error',
      motivo: 'La autorización expiró o no se pudo validar. Probá conectar de nuevo.'
    });
  }

  if (!code) {
    return volverAlPanel(res, base, { mp: 'error', motivo: 'Mercado Pago no devolvió el código de autorización.' });
  }

  try {
    const redirectUri = `${base}/api/mp-callback`;

    // PKCE: recuperamos el verifier guardado al iniciar el flujo.
    let codeVerifier;
    if (stateData.pid) {
      const pending = await consumePendingOAuth(stateData.pid);
      if (!pending) {
        return volverAlPanel(res, base, {
          mp: 'error',
          motivo: 'La verificación de seguridad expiró. Probá conectar de nuevo.'
        });
      }
      codeVerifier = pending.code_verifier;
    }

    const tokenResponse = await exchangeCodeForToken({ code, redirectUri, codeVerifier });
    const row = integrationToRow(tokenResponse);

    if (!row.access_token) {
      throw new Error('Mercado Pago no devolvió un access_token.');
    }

    await saveIntegration(row);

    return volverAlPanel(res, base, {
      mp: 'conectado',
      cuenta: row.mp_user_id,
      modo: row.live_mode ? 'produccion' : 'prueba'
    });
  } catch (err) {
    console.error('[mp-callback]', err);
    return volverAlPanel(res, base, { mp: 'error', motivo: err.message });
  }
}
