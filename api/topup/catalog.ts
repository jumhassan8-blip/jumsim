/**
 * POST /api/topup/catalog — normalized product grid.
 * { countryIso, operatorId? } → { products: TopUpProduct[] }
 * Products sort popular-first by default (client re-sorts if needed).
 */
import { withApi, sendJson } from '../lib/http'
import { topUpCtx } from './shared'
import { resolveTopUpProvider } from './index'

export default withApi(async (body, req, res) => {
  void (await topUpCtx(req))
  const countryIso = typeof body.countryIso === 'string' ? body.countryIso.toUpperCase() : ''
  const operatorId = typeof body.operatorId === 'string' ? body.operatorId : undefined
  if (!/^[A-Z]{2}$/.test(countryIso)) return sendJson(res, 422, { error: 'invalid_country' })

  const provider = resolveTopUpProvider()
  if (!provider) return sendJson(res, 503, { error: 'provider_unavailable', providerConfigured: null })

  const products = await provider.getCatalog(countryIso, operatorId).catch(() => [])
  sendJson(res, 200, { products })
})
