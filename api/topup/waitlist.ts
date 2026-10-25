/**
 * POST /api/topup/waitlist — launch-planning capture for the
 * no-provider state (brief §2). { countryIso, msisdn } — no auth gate:
 * a waitlist must be joinable before accounts exist.
 */
import { withApi, sendJson } from '../lib/http'
import { topUpCtx } from './shared'
import { addWaitlistLead } from '../lib/topup-store'

export default withApi(async (body, req, res) => {
  const ctx = await topUpCtx(req)
  const countryIso = typeof body.countryIso === 'string' ? body.countryIso.toUpperCase() : ''
  const msisdn = typeof body.msisdn === 'string' ? body.msisdn.replace(/\D/g, '') : ''
  if (!/^[A-Z]{2}$/.test(countryIso)) return sendJson(res, 422, { error: 'invalid_country' })
  if (msisdn.length < 8) return sendJson(res, 422, { error: 'invalid_msisdn' })

  addWaitlistLead({ countryIso, msisdn, createdAt: Date.now(), uid: ctx.uid })
  sendJson(res, 200, { ok: true })
})
