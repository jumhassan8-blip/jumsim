import { withApi, sendJson } from '../lib/http'
import { endSession } from '../lib/calls'

/**
 * POST /api/calls/end
 * body: { sid: "CA…", durationSec: 272 }
 *
 * Server bills the call by the second at the rate snapshot taken at start
 * (rate/60 per second). Unanswered / busy (durationSec 0) → no charge.
 * The provider webhook (/api/webhooks/twilio-voice) reconciles live mode;
 * the app renders the balance this endpoint returns — never self-decrements.
 */
export default withApi((body, _req, res) => {
  const sid = typeof body.sid === 'string' ? body.sid : ''
  const durationSec = typeof body.durationSec === 'number' ? body.durationSec : Number(body.durationSec ?? 0)
  if (!sid || !Number.isFinite(durationSec)) {
    return sendJson(res, 400, { error: 'missing_sid_or_durationSec' })
  }
  const result = endSession('local', sid, durationSec)
  if (!result) return sendJson(res, 404, { error: 'session_not_found' })
  sendJson(res, 200, result)
})
