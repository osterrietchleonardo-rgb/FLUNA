import { rejectIfNotAdmin } from './_lib/admin-auth.js';
import { getIntegration, deleteIntegration } from './_lib/supabase.js';
import { config } from './_lib/config.js';

/**
 * Estado de la conexión con Mercado Pago para la pantalla de Integraciones.
 * GET  -> devuelve el estado (nunca los tokens).
 * DELETE -> desconecta la cuenta.
 */
export default async function handler(req, res) {
  if (await rejectIfNotAdmin(req, res)) return;

  try {
    if (req.method === 'DELETE') {
      await deleteIntegration();
      return res.status(200).json({ ok: true, connected: false });
    }

    if (req.method !== 'GET') {
      return res.status(405).json({ ok: false, error: 'Método no permitido.' });
    }

    const configurado = Boolean(config.mpClientId && config.mpClientSecret);
    const integration = await getIntegration();

    if (!integration) {
      return res.status(200).json({
        ok: true,
        connected: false,
        configurado,
        webhookSecretConfigurado: Boolean(config.mpWebhookSecret)
      });
    }

    const expiresAt = integration.expires_at ? new Date(integration.expires_at) : null;
    const diasRestantes = expiresAt
      ? Math.max(0, Math.round((expiresAt.getTime() - Date.now()) / 86400000))
      : null;

    // Se devuelve solo metadata. access_token y refresh_token nunca salen de acá.
    return res.status(200).json({
      ok: true,
      connected: true,
      configurado,
      webhookSecretConfigurado: Boolean(config.mpWebhookSecret),
      mpUserId: integration.mp_user_id,
      liveMode: integration.live_mode,
      conectadoEl: integration.created_at || integration.updated_at,
      expiraEl: integration.expires_at,
      diasRestantes,
      feePorcentaje: config.marketplaceFeePercent,
      pkce: config.mpPkce
    });
  } catch (err) {
    console.error('[mp-status]', err);
    return res.status(err.statusCode || 500).json({ ok: false, error: err.message });
  }
}
