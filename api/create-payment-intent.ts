import { withApi, sendJson } from './lib/http'
import { authoritativePrice, roundCents } from './lib/pricing'
import { createMockPaymentIntent } from './lib/mock'
import { isMockMode } from './lib/orders'

/**
 * POST /api/create-payment-intent
 * body: { planId: string, priceUSD?: number }
 *
 * Validates planId against pricing.json (price authority — the client never
 * dictates an amount) and returns a PaymentIntent-shaped payload.
 * MOCK_MODE=true → fake clientSecret; live → Stripe (STRIPE_SECRET_KEY).
 */
export default withApi((body, _req, res) => {
  const planId = typeof body.planId === 'string' ? body.planId.trim() : ''
  if (!planId) return sendJson(res, 400, { error: 'missing_planId' })

  const check = authoritativePrice(planId, body.priceUSD === undefined ? undefined : Number(body.priceUSD))
  if (!check.parsed || !check.ok) {
    return sendJson(res, 409, { error: 'price_mismatch', expected: check.expected })
  }
  const amountCents = Math.round(roundCents(check.expected!) * 100)

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

  // ── LIVE MODE (MOCK_MODE=false) ────────────────────────────────────
  // const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '...' })
  // const intent = await stripe.paymentIntents.create({
  //   amount: amountCents, currency: 'usd', capture_method: 'manual',
  // })
  // return sendJson(res, 200, { clientSecret: intent.client_secret, ... })
  return sendJson(res, 501, { error: 'live_mode_not_configured', hint: 'set STRIPE_SECRET_KEY and implement the live branch' })
})
