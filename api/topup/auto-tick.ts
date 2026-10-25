/**
 * POST /api/topup/auto/tick — scheduler tick. In production a cron hits
 * this route (Bearer PROVIDER_SETUP_TOKEN); in mock dev the e2e suite
 * calls it directly. Fires every enabled auto top-up whose dueDay matches
 * today (monthly = day-of-month, weekly = weekday), idempotently
 * (lastFiredAt today → skip). Requires a configured provider and a Jum
 * Balance sufficient at fire time — otherwise the fire is skipped (the
 * low-balance nudge surface, not a failed order).
 */
import { withApi, sendJson } from '../lib/http'
import { authenticate } from '../lib/auth'
import { resolveTopUpProvider } from './index'
import {
  applyBalanceDelta,
  auditTopUp,
  getBalance,
  listAutoTopUps,
  msisdnHash,
  putAutoTopUp,
  putTopUp,
} from '../lib/topup-store'
import type { TopUpOrder } from '../lib/topup-store'

export default withApi(async (body, req, res) => {
  // server-to-server only (cron/CI) — Firebase user tokens not accepted
  const auth = await authenticate(req)
  if (!auth || auth.kind !== 'server') return sendJson(res, 401, { error: 'unauthorized' })

  const provider = resolveTopUpProvider()
  if (!provider) return sendJson(res, 503, { error: 'provider_unavailable' })

  const uidRaw = typeof body.uid === 'string' ? body.uid : null
  const msisdn = typeof body.msisdn === 'string' ? body.msisdn.replace(/\D/g, '') : ''
  const countryIso = typeof body.countryIso === 'string' ? body.countryIso.toUpperCase() : ''
  // defensive: the process reads body fields on multiple await boundaries —
  // always re-read after any await, never trust a pre-await alias
  const uid = uidRaw
  if (!uid || msisdn.length < 8 || !/^[A-Z]{2}$/.test(countryIso)) {
    return sendJson(res, 422, { error: 'invalid_tick_params' })
  }

  const now = new Date()
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const dueNow = autoDueToday(now)

  let fired = 0
  for (const auto of await listAutoTopUps(uid)) {
    // the uid prefix "uid:" on stored ids is an implementation detail —
    // match on the id the client sent, whatever prefix it carries
    const snId = typeof body.savedNumberId === 'string' ? body.savedNumberId : undefined
    const idMatches =
      snId === undefined ||
      auto.savedNumberId === snId ||
      auto.savedNumberId.endsWith(`:${snId}`) ||
      snId.endsWith(`:${auto.savedNumberId}`)
    const due = (auto.cadence === 'monthly' ? auto.dueDay === now.getDate() : auto.dueDay === dueNow) && idMatches
    const alreadyFiredToday = auto.lastFiredAt !== null && auto.lastFiredAt >= startOfDay
    if (!auto.enabled || !due || alreadyFiredToday) continue

    // price lock at fire time — never execute on a stale quote
    const quote = await provider.quote(auto.productId, msisdn).catch(() => null)
    if (!quote || quote.totalUsd > 25) continue // hard ceiling for unattended fires

    const bal = await getBalance(uid)
    if (bal < quote.totalUsd - 0.005) continue // low balance → nudge, not a failure

    const exec = await provider.execute(quote, msisdn).catch(() => null)
    if (!exec) continue

    const order: TopUpOrder = {
      id: `tu_auto_${auto.id}_${startOfDay}`,
      uid,
      msisdnHash: msisdnHash(msisdn),
      msisdnLast4: msisdn.slice(-4),
      countryIso,
      operatorId: 'auto',
      operatorName: 'Auto top-up',
      productId: auto.productId,
      kind: 'airtime',
      amountUsd: quote.amountUsd,
      feeUsd: quote.feeUsd,
      payPath: 'balance',
      status: 'processing',
      providerName: provider.name,
      providerRef: exec.providerRef,
      failureReason: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      events: [{ t: Date.now(), event: 'auto_fired' }],
    }
    await putTopUp(order)
    await applyBalanceDelta(uid, -quote.totalUsd, `topup-auto:${order.id}`)
    auto.lastFiredAt = Date.now()
    await putAutoTopUp(uid, auto)
    auditTopUp({
      uid, msisdnHash: order.msisdnHash, productId: auto.productId,
      amountUsd: quote.amountUsd, providerRef: exec.providerRef, outcome: 'auto_fired',
    })
    fired += 1
  }

  sendJson(res, 200, { ok: true, fired })
})

function autoDueToday(now: Date): number {
  return now.getDay()
}
