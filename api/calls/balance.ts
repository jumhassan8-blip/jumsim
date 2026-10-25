import { withApi, sendJson } from '../lib/http'
import { getBalance } from '../lib/calls'

/**
 * POST /api/calls/balance  body: {}
 *
 * Server-authoritative call-credit balance. The app renders only what the
 * server reports and never self-decrements.
 */
export default withApi((_body, _req, res) => {
  sendJson(res, 200, { balanceUSD: getBalance('local') })
})
