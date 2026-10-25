import { withApi, sendJson } from '../lib/http'
import { creditPack, revokePack, getBalance } from '../lib/calls'
import { isMockMode } from '../lib/orders'
import { MOCK_DECLINED_MARKER } from '../lib/mock'

const PACKS = new Set([3, 5, 10, 20])

/**
 * POST /api/calls/credit
 * body: { packUSD: 5, paymentIntentId: "pi_…", clientSecret?: "…" }
 *
 * Credits call time after the Buy Time sheet's Stripe payment succeeds.
 * Idempotent per payment intent — a retried tap can never double-credit.
 * A clientSecret carrying the mock "declined" marker simulates a failed
 * payment (authorize-only world: the pack is revoked, user never charged).
 * LIVE MODE: verify the PaymentIntent actually succeeded with Stripe first.
 */
export default withApi((body, _req, res) => {
  const packUSD = Number(body.packUSD)
  const paymentIntentId = typeof body.paymentIntentId === 'string' ? body.paymentIntentId : ''
  const clientSecret = typeof body.clientSecret === 'string' ? body.clientSecret : ''
  if (!PACKS.has(packUSD)) return sendJson(res, 400, { error: 'unknown_pack' })
  if (!paymentIntentId) return sendJson(res, 400, { error: 'missing_paymentIntentId' })

  if (isMockMode() && clientSecret.includes(MOCK_DECLINED_MARKER)) {
    revokePack('local', packUSD, paymentIntentId)
    return sendJson(res, 402, { error: 'payment_failed_no_charge' })
  }

  // LIVE MODE:
  // const pi = await stripe.paymentIntents.retrieve(paymentIntentId)
  // if (pi.status !== 'succeeded') return sendJson(res, 402, { error: 'payment_failed_no_charge' })

  const balanceUSD = creditPack('local', packUSD, paymentIntentId)
  sendJson(res, 200, { balanceUSD, packUSD })
})
