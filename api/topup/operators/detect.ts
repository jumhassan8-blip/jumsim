/**
 * POST /api/topup/operators/detect — provider-authoritative operator
 * lookup for a full international MSISDN (portable numbers included).
 * { msisdn } → { operator: {id,name,detected} | null }
 * When no provider is configured → 503 { providerConfigured: null } and the
 * client keeps the waitlist state up (never a fabricated operator).
 */
import { withApi, sendJson } from '../../lib/http'
import { topUpCtx } from '../shared'
import { resolveTopUpProvider } from '../index'

export default withApi(async (body, req, res) => {
  void (await topUpCtx(req))
  const msisdn = typeof body.msisdn === 'string' ? body.msisdn.replace(/\D/g, '') : ''
  if (msisdn.length < 8) return sendJson(res, 422, { error: 'invalid_msisdn' })

  const provider = resolveTopUpProvider()
  if (!provider) return sendJson(res, 503, { error: 'provider_unavailable', providerConfigured: null })

  const operator = await provider.detectOperator(msisdn).catch(() => null)
  sendJson(res, 200, { operator })
})
