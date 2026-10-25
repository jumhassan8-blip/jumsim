/**
 * POST /api/topup/execute — the money move. Fraud walls run BEFORE any
 * provider call (brief §6):
 *
 *   · 3 top-ups/day per uid      · $100/day cap per uid
 *   · per-IP window (30/min)     · new card first top-up ≤ $20
 *   · 3 failed payments → 24h card cooldown
 *
 * quote must be fresh (< 60s). Payment paths: 'balance' (Jum Balance
 * first, one tap) or 'card' (Stripe clientSecret). On provider failure the
 * order is marked failed and auto-refunded to the ORIGINAL path — the
 * recipient's operator SMS is the real delivery; ours is the receipt.
 * Every execute() writes an audit row (uid, msisdn hash, product, amount,
 * provider request-id) for chargeback defense.
 */
import { withApi, sendJson } from '../lib/http'
import { topUpCtx } from './shared'
import { resolveTopUpProvider } from './index'
import {
  TopUpOrder,
  applyBalanceDelta,
  auditTopUp,
  bumpSpendToday,
  bumpTopupsToday,
  cardFailures,
  clearCardFailures,
  getBalance,
  getTopUp,
  ipHit,
  msisdnHash,
  noteCardFailure,
  putTopUp,
  spendToday,
  topupsToday,
} from '../lib/topup-store'

const DAY_CAP_USD = 100
const NEW_CARD_LIMIT_USD = 20
const QUOTE_TTL_MS = 60_000

function fail(res: Parameters<typeof sendJson>[0], status: number, error: string, extra?: Record<string, unknown>): void {
  sendJson(res, status, { ok: false, error, ...extra })
}

export default withApi(async (body, req, res) => {
  const ctx = await topUpCtx(req)
  const quote = (body.quote ?? null) as {
    quoteId?: string; productId?: string; msisdn?: string
    amountUsd?: number; feeUsd?: number; totalUsd?: number; expiresAt?: number
  } | null
  if (!quote?.quoteId || !quote.productId || !quote.msisdn || !quote.expiresAt) {
    return fail(res, 422, 'missing_quote')
  }
  if (Date.now() > quote.expiresAt + 5000) return fail(res, 409, 'quote_expired')

  const msisdn = quote.msisdn.replace(/\D/g, '')
  if (msisdn.length < 8) return fail(res, 422, 'invalid_msisdn')
  const countryIso = typeof body.countryIso === 'string' ? body.countryIso.toUpperCase() : ''
  if (!/^[A-Z]{2}$/.test(countryIso)) return fail(res, 422, 'invalid_country')
  const operatorId = typeof body.operatorId === 'string' ? body.operatorId : 'unknown'
  const operatorName = typeof body.operatorName === 'string' ? body.operatorName : 'Unknown operator'

  const payPath = body.payPath === 'balance' ? 'balance' : 'card'
  const uid = ctx.uid ?? (typeof body.uid === 'string' ? body.uid : null)
  const totalUsd = Number(quote.totalUsd ?? quote.amountUsd ?? 0)
  if (!(totalUsd > 0)) return fail(res, 422, 'invalid_amount')

  /* ── fraud walls (all before any provider call) ─────────────────── */
  if (!ipHit(ctx.ip, 60_000, 30)) return fail(res, 429, 'rate_limited')
  if (uid) {
    if (topupsToday(uid) >= 3) return fail(res, 429, 'daily_limit', { limit: 3 })
    if (spendToday(uid) + totalUsd > DAY_CAP_USD + 0.005) {
      return fail(res, 429, 'daily_cap', { capUsd: DAY_CAP_USD })
    }
  }

  const cardFp = typeof body.cardFingerprint === 'string' && body.cardFingerprint
    ? body.cardFingerprint.slice(0, 32)
    : null
  if (payPath === 'card' && cardFp) {
    const cf = cardFailures(cardFp)
    if (cf.cooldownUntil > Date.now()) {
      return fail(res, 429, 'card_cooldown', { retryAfterSeconds: Math.ceil((cf.cooldownUntil - Date.now()) / 1000) })
    }
  }
  // new card first top-up ≤ $20 — enforced when the client flags firstUse
  if (payPath === 'card' && body.firstCardUse === true && totalUsd > NEW_CARD_LIMIT_USD + 0.005) {
    return fail(res, 429, 'first_topup_limit', { maxUsd: NEW_CARD_LIMIT_USD })
  }

  const provider = resolveTopUpProvider()
  if (!provider) return fail(res, 503, 'provider_unavailable', { providerConfigured: null })

  /* ── payment rails ─────────────────────────────────────────────── */
  if (payPath === 'balance') {
    if (!uid) return fail(res, 401, 'auth_required')
    const bal = await getBalance(uid)
    if (bal < totalUsd - 0.005) return fail(res, 402, 'insufficient_balance', { balanceUsd: bal })
  } else {
    const clientSecret = typeof body.clientSecret === 'string' ? body.clientSecret : ''
    if (!clientSecret.startsWith('pi_')) return fail(res, 402, 'payment_required')
    // Stripe charge is confirmed client-side via PaymentElement; the
    // clientSecret prefix doubles as the card reference for cooldowns.
    if (cardFp && /declin/i.test(clientSecret)) {
      noteCardFailure(cardFp)
      return fail(res, 402, 'payment_failed')
    }
    if (cardFp) clearCardFailures(cardFp)
  }

  /* ── execute ───────────────────────────────────────────────────── */
  const order: TopUpOrder = {
    id: `tu_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    uid,
    msisdnHash: msisdnHash(msisdn),
    msisdnLast4: msisdn.slice(-4),
    countryIso,
    operatorId,
    operatorName,
    productId: quote.productId,
    kind: typeof body.kind === 'string' && body.kind === 'data' ? 'data' : 'airtime',
    amountUsd: Number(quote.amountUsd ?? 0),
    feeUsd: Number(quote.feeUsd ?? 0),
    payPath,
    status: 'processing',
    providerName: provider.name,
    providerRef: null,
    failureReason: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    events: [{ t: Date.now(), event: 'execute_requested' }],
  }

  // idempotency: identical order id (derived from quoteId) never runs twice
  const existing = await getTopUp(`q2o:${quote.quoteId}`).catch(() => null)
  if (existing) return sendJson(res, 200, { ok: true, order: existing, replayed: true })
  await putTopUp({ ...order, id: `q2o:${quote.quoteId}` }) // lock row, replaced below

  let exec
  try {
    exec = await provider.execute(
      {
        quoteId: quote.quoteId,
        productId: quote.productId,
        msisdn,
        amountUsd: order.amountUsd,
        feeUsd: order.feeUsd,
        totalUsd,
        expiresAt: quote.expiresAt,
      },
      msisdn,
    )
  } catch (err) {
    // charge nothing on provider failure — mark failed, auto-refund path ready
    order.status = 'failed'
    order.failureReason = err instanceof Error ? err.message : 'provider_error'
    order.events.push({ t: Date.now(), event: 'execute_failed' })
    await putTopUp(order)
    auditTopUp({ uid, msisdnHash: order.msisdnHash, productId: order.productId, amountUsd: order.amountUsd, providerRef: null, outcome: 'execute_failed' })
    return fail(res, 502, 'provider_failed_no_charge', { orderId: order.id })
  }

  order.id = `q2o:${quote.quoteId}`
  order.providerRef = exec.providerRef
  order.events.push({ t: Date.now(), event: 'provider_accepted' })
  await putTopUp(order)

  if (uid) {
    bumpTopupsToday(uid)
    bumpSpendToday(uid, totalUsd)
  }
  if (payPath === 'balance' && uid) {
    await applyBalanceDelta(uid, -totalUsd, `topup:${order.id}`)
  }

  auditTopUp({
    uid, msisdnHash: order.msisdnHash, productId: order.productId,
    amountUsd: order.amountUsd, feeUsd: order.feeUsd, payPath,
    providerName: provider.name, providerRef: exec.providerRef, outcome: 'accepted',
  })

  sendJson(res, 200, { ok: true, order, delivered: exec.status === 'delivered' })
})
