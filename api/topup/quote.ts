/**
 * POST /api/topup/quote — price lock for the pay step.
 * { productId, msisdn } → TopUpQuote (expiresAt = now + 60s).
 * The client re-quotes on expiry; execute() refuses a stale quote.
 */
import { withApi, sendJson } from '../lib/http'
import { topUpCtx } from './shared'
import { resolveTopUpProvider } from './index'

export default withApi(async (body, req, res) => {
  void (await topUpCtx(req))
  const productId = typeof body.productId === 'string' ? body.productId : ''
  const msisdn = typeof body.msisdn === 'string' ? body.msisdn.replace(/\D/g, '') : ''
  if (!productId) return sendJson(res, 422, { error: 'missing_productId' })
  if (msisdn.length < 8) return sendJson(res, 422, { error: 'invalid_msisdn' })

  const provider = resolveTopUpProvider()
  if (!provider) return sendJson(res, 503, { error: 'provider_unavailable', providerConfigured: null })

  const quote = await provider.quote(productId, msisdn).catch((err: Error) => {
    throw Object.assign(new Error(`quote_failed:${err.message}`), { status: 502 })
  })
  sendJson(res, 200, quote)
})
