/**
 * POST /api/providers/setup — one-shot provider wiring, run on deploy.
 *
 *   1. Registers our webhook URL with the ACTIVE provider
 *      (eSIM Access: POST /webhook/save → https://jumesim.com/api/webhooks/esimaccess;
 *      eSIM Go: dashboard-configured — returned with a hint).
 *   2. Verifies the registration by querying it back.
 *   3. Warms the coverage catalog so the first buyer never pays the
 *      cold-cache latency.
 *
 * Protected by PROVIDER_SETUP_TOKEN (Bearer). Vercel: call once after
 * deploy, e.g. a CI step:
 *   curl -X POST https://jumesim.com/api/providers/setup \
 *     -H "Authorization: Bearer $PROVIDER_SETUP_TOKEN"
 */
import { withApi, sendJson } from '../lib/http'
import { getProvider, activeProviderName } from './index'

export default withApi(async (body, req, res) => {
  const token = process.env.PROVIDER_SETUP_TOKEN
  const auth = req.headers.authorization ?? ''
  if (!token || auth !== `Bearer ${token}`) {
    sendJson(res, 401, { error: 'unauthorized' })
    return
  }

  const provider = getProvider()
  const defaultOrigin = (process.env.APP_ORIGIN ?? 'https://jumesim.com').split(',')[0].trim()
  const url = String(body.webhookUrl ?? `${defaultOrigin}/api/webhooks/${provider.name}`)

  try {
    const registration = await provider.registerWebhook(url)
    let catalogCount: number | null = null
    try {
      catalogCount = (await provider.catalog()).length
    } catch (err) {
      console.warn('[providers/setup] catalog warm failed:', err)
    }
    sendJson(res, 200, {
      ok: registration.ok,
      provider: activeProviderName(),
      webhookUrl: url,
      registeredAs: registration.current ?? null,
      catalogPackages: catalogCount,
      note: registration.error ?? null,
    })
  } catch (err) {
    sendJson(res, 502, {
      ok: false,
      provider: activeProviderName(),
      error: err instanceof Error ? err.message : String(err),
    })
  }
})
