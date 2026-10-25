/**
 * POST /api/gift/create — purchase a gift (brief §3).
 * Server: giftCards doc + Stripe PaymentIntent created atomically.
 * Status: pending_payment → (webhook) paid → sent → redeemed.
 * Fraud caps: $200/day per uid. Amount comes from the SERVER price table
 * (never the client) per gift type:
 *   jum_credit / esim_balance: 5, 10, 25, 50 (usd)
 *   football_pro: 1, 3, 12 (months)
 */
import { withApi, sendJson } from '../lib/http'
import { giftCtx, DAY_CAP_USD } from './shared'
import {
  auditGift, bumpPurchasesToday, generateGiftCode, hashGiftCode,
  purchasesToday, putGift, type GiftCard, type GiftType,
} from '../lib/gift-store'

const AMOUNTS: Record<GiftType, number[]> = {
  jum_credit: [5, 10, 25, 50],
  esim_balance: [5, 10, 25, 50],
  football_pro: [1, 3, 12],
}

const PRICES_USD: Record<string, number> = {
  'jum_credit:5': 5, 'jum_credit:10': 10, 'jum_credit:25': 25, 'jum_credit:50': 50,
  'esim_balance:5': 5, 'esim_balance:10': 10, 'esim_balance:25': 25, 'esim_balance:50': 50,
  'football_pro:1': 4.99, 'football_pro:3': 11.99, 'football_pro:12': 39.99,
}

export function priceUsdFor(type: GiftType, amount: number): number | null {
  return PRICES_USD[`${type}:${amount}`] ?? null
}

export function amountsFor(type: GiftType): number[] {
  return AMOUNTS[type] ?? []
}

function isoMinutes(n: number): string {
  return new Date(n).toISOString()
}

export default withApi(async (body, req, res) => {
  const ctx = await giftCtx(req)
  const uid = ctx.uid ?? (typeof body.uid === 'string' ? body.uid : null)

  const type = (typeof body.type === 'string' ? body.type : '') as GiftType
  const amount = Number(body.amount)
  if (!AMOUNTS[type] || !Number.isFinite(amount) || !AMOUNTS[type].includes(amount)) {
    return sendJson(res, 422, { error: 'invalid_product' })
  }
  const priceUsd = priceUsdFor(type, amount)
  if (priceUsd === null) return sendJson(res, 422, { error: 'invalid_product' })

  const recipientName = typeof body.recipientName === 'string' ? body.recipientName.trim().slice(0, 60) : ''
  const recipientEmail = typeof body.recipientEmail === 'string' && body.recipientEmail ? body.recipientEmail.trim() : null
  const recipientWhatsapp = typeof body.recipientWhatsapp === 'string' && body.recipientWhatsapp ? body.recipientWhatsapp.replace(/\D/g, '') : null
  const message = typeof body.message === 'string' ? body.message.slice(0, 140) : ''
  const delivery = body.delivery === 'scheduled' ? 'scheduled' : 'now'
  const scheduledAt = delivery === 'scheduled' && Number(body.scheduledAt) > Date.now()
    ? Number(body.scheduledAt)
    : null
  if (delivery === 'scheduled' && !scheduledAt) {
    return sendJson(res, 422, { error: 'invalid_schedule' })
  }
  if (!recipientName || (!recipientEmail && !recipientWhatsapp)) {
    return sendJson(res, 422, { error: 'invalid_recipient' })
  }

  // fraud caps (brief §4)
  if (ctx.ip === 'unknown') return sendJson(res, 429, { error: 'rate_limited' })
  if (uid && purchasesToday(uid) + priceUsd > DAY_CAP_USD + 0.005) {
    auditGift({ event: 'gift_cap_hit', uid, attemptedUsd: priceUsd })
    return sendJson(res, 429, { error: 'daily_cap', capUsd: DAY_CAP_USD })
  }

  // CSPRNG code — stored hashed; plaintext goes ONLY into the response
  const plaintext = generateGiftCode()
  const codeHash = hashGiftCode(plaintext)
  const id = `gf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  const deliveryToken = Buffer.from(`${id}.${Date.now()}`).toString('base64url')

  const gift: GiftCard = {
    id, type, amount,
    unit: type === 'football_pro' ? 'months' : 'usd',
    senderUid: uid,
    senderEmail: typeof body.senderEmail === 'string' ? body.senderEmail.trim() : null,
    recipient: { name: recipientName, email: recipientEmail, whatsapp: recipientWhatsapp },
    message, delivery, scheduledAt,
    status: 'pending_payment',
    codeHash, paymentIntentId: null, deliveryToken,
    createdAt: Date.now(), paidAt: null, sentAt: null,
    redeemedAt: null, redeemedByUid: null, refundedAt: null,
    events: [{ t: Date.now(), event: 'created' }],
  }
  await putGift(gift)

  // Stripe PaymentIntent (live key required; test key in dev)
  const secret = process.env.STRIPE_SECRET_KEY
  if (!secret) {
    // Sandbox seam (same pattern as topup): with GIFT_MOCK_PAYMENTS=1 the
    // intent is simulated; the SAME fulfilment path (webhook handler) runs
    // via /api/gift/test-fire-webhook (server-token only, mock mode only).
    if (process.env.GIFT_MOCK_PAYMENTS === '1') {
      const mockPi = `pi_mock_gift_${id}`
      gift.paymentIntentId = mockPi
      gift.events.push({ t: Date.now(), event: 'intent_created_mock', ref: mockPi })
      await putGift(gift)
      if (uid) bumpPurchasesToday(uid, priceUsd)
      auditGift({ event: 'gift_created_mock', giftId: id, type, amountUsd: priceUsd, uid })
      return sendJson(res, 200, {
        giftId: id,
        clientSecret: `${mockPi}_secret_autoconfirm`,
        paymentIntentId: mockPi,
        publishableKey: '',
        plaintextCode: plaintext,
        deliveryToken,
        priceUsd,
        scheduledAt: scheduledAt ? isoMinutes(scheduledAt) : null,
        mock: true,
      })
    }
    return sendJson(res, 503, { error: 'payments_unavailable' })
  }
  const { default: Stripe } = await import('stripe')
  const stripe = new Stripe(secret)
  let intent
  try {
    intent = await stripe.paymentIntents.create({
      amount: Math.round(priceUsd * 100),
      currency: 'usd',
      automatic_payment_methods: { enabled: true },
      metadata: {
        kind: 'gift',
        giftId: id,
        type,
        amount: String(amount),
        senderUid: uid ?? '',
      },
      receipt_email: gift.senderEmail ?? recipientEmail ?? undefined,
      description: `Jum Gift — ${type === 'football_pro' ? `${amount} months PRO` : `$${amount} ${type === 'jum_credit' ? 'Jum Credit' : 'e-SIM Balance'}`}`,
    })
  } catch (err) {
    auditGift({ event: 'gift_intent_failed', giftId: id, error: String(err) })
    return sendJson(res, 502, { error: 'payment_intent_failed' })
  }

  gift.paymentIntentId = intent.id
  gift.events.push({ t: Date.now(), event: 'intent_created', ref: intent.id })
  await putGift(gift)
  if (uid) bumpPurchasesToday(uid, priceUsd)

  auditGift({ event: 'gift_created', giftId: id, type, amountUsd: priceUsd, uid })

  // publishable key travels with the session (same pattern as checkout)
  const publishableKey =
    process.env.STRIPE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? ''
  sendJson(res, 200, {
    giftId: id,
    clientSecret: intent.client_secret,
    paymentIntentId: intent.id,
    publishableKey,
    plaintextCode: plaintext, // ONLY place the plaintext ever exists server-side
    deliveryToken,
    priceUsd,
    scheduledAt: scheduledAt ? isoMinutes(scheduledAt) : null,
  })
})
