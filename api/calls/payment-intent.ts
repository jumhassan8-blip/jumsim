import { withApi, sendJson } from '../lib/http'
import { createMockPaymentIntent } from '../lib/mock'
import { isMockMode } from '../lib/orders'

const PACKS = new Set([3, 5, 10, 20])

/**
 * POST /api/calls/payment-intent  body: { packUSD: 5 }
 *
 * Stripe PaymentIntent for a call-time pack. The server is the price
 * authority — the client only names the pack, never an amount.
 * Pair with /api/calls/credit after the payment succeeds.
 */
export default withApi((body, _req, res) => {
  const packUSD = Number(body.packUSD)
  if (!PACKS.has(packUSD)) return sendJson(res, 400, { error: 'unknown_pack' })
  const amountCents = packUSD * 100

  if (isMockMode()) {
    const intent = createMockPaymentIntent(amountCents)
    return sendJson(res, 200, {
      clientSecret: intent.clientSecret,
      paymentIntentId: intent.id,
      amount: amountCents,
      currency: intent.currency,
      mock: true,
    })
  }

  // LIVE MODE: stripe.paymentIntents.create({ amount: amountCents, currency: 'usd' })
  return sendJson(res, 501, { error: 'live_mode_not_configured' })
})
