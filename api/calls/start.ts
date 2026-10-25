import { withApi, sendJson } from '../lib/http'
import { createSession, getBalance, rateForIso, EMERGENCY_NUMBERS } from '../lib/calls'
import { isMockMode } from '../lib/orders'

const MIN_START_SECONDS = 60

/**
 * POST /api/calls/start
 * body: { to: "+49 151 2345678", iso2: "DE" }
 *
 * Path A (default): in-app VoIP via Twilio Voice. Server checks the balance
 * BEFORE connect, snapshots the destination rate, and returns a Voice token
 * + call SID. Guardrails enforced here (never client-side):
 *   - emergency numbers (112/911/999) are refused — use the regular SIM
 *   - one active call per account
 *   - balance ≥ 60s at the destination rate, else 402 insufficient_credit
 * MOCK_MODE → a simulated session (ring 3s, fake answer); token: null.
 */
export default withApi((body, _req, res) => {
  const to = typeof body.to === 'string' ? body.to.trim() : ''
  const iso2 = typeof body.iso2 === 'string' ? body.iso2.trim().toUpperCase() : ''
  if (!to || !iso2) return sendJson(res, 400, { error: 'missing_to_or_iso2' })

  const digits = to.replace(/\D/g, '')
  if (EMERGENCY_NUMBERS.includes(to.replace(/^\+/, '').replace(/[\s()-]/g, '')) || EMERGENCY_NUMBERS.includes(digits)) {
    return sendJson(res, 403, {
      error: 'emergency_number',
      message: 'Emergency calls must use your regular SIM — they are free and work without signal apps.',
    })
  }
  if (!rateForIso(iso2)) return sendJson(res, 400, { error: 'unknown_destination' })

  const started = createSession('local', to, iso2, MIN_START_SECONDS)
  if (!started.ok) {
    const status = started.error === 'insufficient_credit' ? 402 : 409
    return sendJson(res, status, {
      error: started.error,
      balanceUSD: started.balanceUSD,
      requiredUSD: started.requiredUSD,
      minStartSeconds: MIN_START_SECONDS,
    })
  }

  const s = started.session
  const balanceUSD = getBalance('local')
  // LIVE MODE: mint a Twilio Voice token here (AccessToken + VoiceGrant with
  // outgoing application sid, callerId = the account's rented number).
  return sendJson(res, 200, {
    sid: s.sid,
    token: isMockMode() ? null : undefined,
    to: s.to,
    iso2: s.iso2,
    ratePerMin: s.ratePerMin,
    balanceUSD,
    balanceSeconds: Math.floor((balanceUSD / s.ratePerMin) * 60),
    simulated: isMockMode(),
  })
})
