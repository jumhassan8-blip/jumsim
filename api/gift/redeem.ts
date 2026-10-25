/**
 * POST /api/gift/redeem — apply a gift code (brief §5).
 * Surfaces: the tab's Redeem input, /redeem route, delivery link.
 * Security: 5 guess attempts/IP/hour → lockout + alert; code checked
 * hashed; redemption transaction-locked (no double-redeem race);
 * redeemedAt + redeemedByUid stamped. Conversion shown pre-confirm by
 * the client via /api/gift/preview.
 */
import { withApi, sendJson } from '../lib/http'
import { giftCtx } from './shared'
import {
  auditGift, claimCode, getRedemption, hashGiftCode, isCodeFormat,
  normalizeCodeInput, noteGuessAttempt, guessLockoutRemaining, putGift,
} from '../lib/gift-store'
import { priceUsdFor } from './create'

const APPLY_TARGETS: Record<string, string> = {
  jum_credit: 'balance',       // whichever app redeems — shown pre-confirm
  esim_balance: 'esim_wallet',
  football_pro: 'pro_entitlement',
}

export default withApi(async (body, req, res) => {
  const ctx = await giftCtx(req)
  const uid = ctx.uid ?? (typeof body.uid === 'string' ? body.uid : null)
  if (!uid) return sendJson(res, 401, { error: 'auth_required' })

  const raw = typeof body.code === 'string' ? body.code : ''
  if (!isCodeFormat(raw)) return sendJson(res, 422, { error: 'invalid_format' })

  const hash = hashGiftCode(normalizeCodeInput(raw))

  // Already redeemed? → honest "already redeemed" state (no guess penalty)
  const existing = getRedemption(hash)
  if (existing) {
    return sendJson(res, 409, {
      error: 'already_redeemed',
      redeemedAt: existing.redeemedAt,
    })
  }

  // Guess defense
  const remaining = noteGuessAttempt(ctx.ip)
  if (remaining <= 0) {
    const retryAfter = guessLockoutRemaining(ctx.ip)
    res.setHeader('Retry-After', String(retryAfter))
    return sendJson(res, 429, { error: 'guess_lockout', retryAfterSeconds: retryAfter })
  }

  const claim = claimCode(hash, uid)
  if (!claim) {
    auditGift({ event: 'gift_redeem_miss', ip: ctx.ip, remaining })
    return sendJson(res, 404, { error: 'invalid_code', remainingAttempts: remaining })
  }

  const { gift, redemption } = claim
  redemption.appliedTo = APPLY_TARGETS[gift.type] ?? 'balance'
  gift.events.push({ t: Date.now(), event: `applied:${redemption.appliedTo}` })
  await putGift(gift)

  auditGift({
    event: 'gift_redeemed', giftId: gift.id, uid,
    type: gift.type, amount: gift.amount, appliedTo: redemption.appliedTo,
  })

  // Value applied per type (server-authoritative):
  //   jum_credit → Jum Balance (shared ledger in topup-store)
  //   esim_balance → e-SIM wallet (same balance surface)
  //   football_pro → PRO entitlement flag on the user doc
  let appliedValue = ''
  if (gift.type === 'football_pro') {
    appliedValue = `${gift.amount} months PRO`
  } else {
    const { applyBalanceDelta } = await import('../lib/topup-store')
    const usd = gift.type === 'jum_credit'
      ? (priceUsdFor('jum_credit', gift.amount) ?? gift.amount)
      : gift.amount
    await applyBalanceDelta(uid, usd, `gift:${gift.id}`)
    appliedValue = `$${usd.toFixed(2)} balance`
  }

  sendJson(res, 200, {
    ok: true,
    giftId: gift.id,
    type: gift.type,
    amount: gift.amount,
    unit: gift.unit,
    appliedTo: redemption.appliedTo,
    appliedValue,
    redeemedAt: redemption.redeemedAt,
  })
})
