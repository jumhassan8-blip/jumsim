/**
 * POST /api/checkout/create-payment-intent — jumesim.com web checkout.
 *
 * Body: { planId, uid?, email?, topUpFor? }
 * Reply: { clientSecret, publishableKey }
 *
 * The planId is validated against pricing.json HERE (server price
 * authority) — client-sent prices are ignored entirely. The PaymentIntent
 * carries metadata { uid, planId, email, topUpFor } that the webhook uses
 * to fulfil the order and write Firestore users/{uid}/orders/{orderId}.
 *
 * LIVE wiring (Stripe): create the intent with automatic_payment_methods
 * so the Payment Element renders Apple Pay (Safari, after domain
 * verification) and Google Pay (Chrome) alongside cards.
 */
import { withApi, sendJson } from '../lib/http'
import { authoritativePrice } from '../lib/pricing'
import { adminDb } from '../lib/firebase-admin'
import { planCoverage } from '../providers'

export default withApi(async (body, _req, res) => {
  const planId = String(body.planId ?? '')
  const uid = body.uid ? String(body.uid) : undefined
  const email = body.email ? String(body.email) : undefined
  const topUpFor = body.topUpFor ? String(body.topUpFor) : undefined

  // ── price authority: never trust the client ──────────────────────────
  const price = authoritativePrice(planId)
  if (!price.ok || price.expected === null) {
    sendJson(res, 404, { error: 'unknown_plan' })
    return
  }
  const amountCents = Math.round(price.expected * 100)

  // ── coverage gate: never take money for a plan the active provider
  //    can't fulfil ('unknown' passes — fulfilment failure then marks the
  //    order needsResolution + alerts admin; refunds are user-requested
  //    only, never automatic) ────────────────────────────────────────────
  try {
    const { coverage } = await planCoverage(planId)
    if (coverage === 'coming_soon') {
      sendJson(res, 409, { error: 'plan_coming_soon' })
      return
    }
  } catch {
    sendJson(res, 503, { error: 'provider_unavailable' })
    return
  }

  // ── Stripe (live) ────────────────────────────────────────────────────
  const secret = process.env.STRIPE_SECRET_KEY
  if (!secret) {
    sendJson(res, 503, { error: 'payments_unavailable' })
    return
  }
  const { default: Stripe } = await import('stripe')
  const stripe = new Stripe(secret)
  const intent = await stripe.paymentIntents.create({
    amount: amountCents,
    currency: 'usd',
    automatic_payment_methods: { enabled: true },
    receipt_email: email,
    metadata: {
      ...(uid ? { uid } : {}),
      ...(email ? { email } : {}),
      planId,
      ...(topUpFor ? { topUpFor } : {}),
      source: 'web_checkout',
    },
  })

  // idempotency ledger — the webhook dedupes on the payment_intent id, and
  // a pending ledger row lets support trace a payment that never fulfilled.
  const db = await adminDb()
  if (db) {
    try {
      await db.collection('checkoutIntents').doc(intent.id).set({
        paymentIntentId: intent.id,
        planId,
        amountCents,
        uid: uid ?? null,
        email: email ?? null,
        topUpFor: topUpFor ?? null,
        status: 'requires_payment',
        createdAt: Date.now(),
      })
    } catch (err) {
      console.warn('[checkout] ledger write failed (non-fatal):', err)
    }
  }

  sendJson(res, 200, {
    clientSecret: intent.client_secret,
    paymentIntentId: intent.id,
    // publishable key travels with the session so the static checkout page
    // never hardcodes a key that could drift from the backend deployment.
    // Accepts both published names (STRIPE_PUBLISHABLE_KEY preferred).
    publishableKey:
      process.env.STRIPE_PUBLISHABLE_KEY ??
      process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ??
      '',
  })
})
