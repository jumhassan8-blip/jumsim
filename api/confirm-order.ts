import { withApi, sendJson } from './lib/http'
import { authenticate } from './lib/auth'
import { authoritativePrice, roundCents } from './lib/pricing'
import { findByIdempotency, getOrder, isMockMode, putOrder, type StoredOrder } from './lib/orders'
import { createMockEsimOrder, MOCK_DECLINED_MARKER, mockOrderId } from './lib/mock'
import { GUARANTEE_WINDOW_MS } from './lib/guarantee'

/**
 * POST /api/confirm-order
 * body: { planId, email, clientSecret?, priceUSD?, topUpFor?, idempotencyKey? }
 *
 * MOCK_MODE=true → simulates eSIM Go: creates a mock order
 * {orderId, iccid, qrUrl, lpaString, smdpAddress, matchingId}, stores it,
 * and returns the install payload. Live → real eSIM Go call with
 * ESIM_GO_API_KEY, then Stripe capture (authorize-only until now).
 */
export default withApi(async (body, req, res) => {
  // security brief §3: this route can reach the provider key — Firebase ID
  // token or PROVIDER_SETUP_TOKEN required, 401 otherwise. The shipped
  // checkout flow never calls this legacy endpoint (it uses
  // /api/checkout/*), so guest checkout is unaffected.
  const authCtx = await authenticate(req)
  if (!authCtx) return sendJson(res, 401, { error: 'unauthorized' })

  const planId = typeof body.planId === 'string' ? body.planId.trim() : ''
  const email = typeof body.email === 'string' ? body.email.trim() : ''
  const clientSecret = typeof body.clientSecret === 'string' ? body.clientSecret : undefined
  const topUpFor = typeof body.topUpFor === 'string' && body.topUpFor ? body.topUpFor : undefined
  const uid = typeof body.uid === 'string' && body.uid ? body.uid : undefined
  const idempotencyKey = req.headers['idempotency-key'] as string | undefined

  if (!planId) return sendJson(res, 400, { error: 'missing_planId' })
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return sendJson(res, 400, { error: 'invalid_email' })

  // price authority — never trust the client's number
  const check = authoritativePrice(planId, body.priceUSD === undefined ? undefined : Number(body.priceUSD))
  if (!check.parsed || !check.ok) {
    return sendJson(res, 409, { error: 'price_mismatch', expected: check.expected })
  }

  // idempotent replay: same key → same order, never a duplicate
  if (idempotencyKey) {
    const existing = await findByIdempotency(idempotencyKey)
    if (existing) return sendJson(res, 200, { ...existing, replayed: true })
  }

  // simulated decline — the app voids, never captures, and says so
  if (clientSecret?.includes(MOCK_DECLINED_MARKER)) {
    return sendJson(res, 402, { error: 'payment_failed_no_charge' })
  }

  const expiresAt = Date.now() + (check.parsed.days ?? 30) * 24 * 60 * 60 * 1000

  if (!isMockMode()) {
    // ── LIVE MODE (MOCK_MODE=false) ─────────────────────────────────
    // 1. const eg = await esimGo('/orders', { method: 'POST', headers: { Authorization: `Bearer ${process.env.ESIM_GO_API_KEY}` }, body: ... })
    // 2. capture the Stripe PI from clientSecret
    // 3. store the record
    return sendJson(res, 501, { error: 'live_mode_not_configured', hint: 'set ESIM_GO_API_KEY and implement the live branch' })
  }

  const esim = createMockEsimOrder(topUpFor)
  const createdAt = Date.now()
  // the Stripe PaymentIntent id is the clientSecret prefix (pi_…_secret_…)
  const paymentIntentId = clientSecret?.split('_secret')[0]
  const order: StoredOrder = {
    orderId: mockOrderId(),
    iccid: esim.iccid,
    qrUrl: esim.qrUrl,
    lpaString: esim.lpaString,
    smdpAddress: esim.smdpAddress,
    matchingId: esim.matchingId,
    expiresAt,
    planId,
    email,
    uid,
    createdAt,
    topUpFor,
    status: 'active',
    idempotencyKey,
    // money-back guarantee: 10-minute window for a USER-REQUESTED refund
    // (POST /api/refund/execute — terminate at the supplier first, then
    // Stripe refund; never automatic). Stripe refund target recorded.
    priceUSD: roundCents(check.expected!),
    paymentIntentId,
    // user-requested refund window end — display only; the server re-checks
    // at execute time (POST /api/refund/execute)
    guaranteeEndsAt: createdAt + GUARANTEE_WINDOW_MS,
  }
  await putOrder(order)

  return sendJson(res, 200, {
    orderId: order.orderId,
    iccid: order.iccid,
    qrUrl: order.qrUrl,
    lpaString: order.lpaString,
    smdpAddress: order.smdpAddress,
    matchingId: order.matchingId,
    expiresAt: order.expiresAt,
    planId: order.planId,
    email: order.email,
    createdAt: order.createdAt,
    topUpFor: order.topUpFor,
    status: order.status,
    priceUSD: roundCents(check.expected!),
    mock: true,
  })
})
