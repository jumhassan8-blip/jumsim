/**
 * POST /api/gift/admin — support console (brief §6). Server-to-server
 * token only. Actions:
 *   lookup  { fragment }   — find by code-hash prefix (8+ chars)
 *   void    { giftId }     — pre-redemption only
 *   refund  { giftId }     — unredeemed AND older than 30 days, support-only
 * Every action is audit-logged. NO auto-refund exists anywhere.
 */
import { withApi, sendJson } from '../lib/http'
import { authenticate } from '../lib/auth'
import { auditGift, getGift, putGift } from '../lib/gift-store'
import crypto from 'node:crypto'

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000

export default withApi(async (body, req, res) => {
  const auth = await authenticate(req)
  if (!auth || auth.kind !== 'server') return sendJson(res, 401, { error: 'unauthorized' })

  const action = typeof body.action === 'string' ? body.action : ''
  const giftId = typeof body.giftId === 'string' ? body.giftId : ''

  if (action === 'lookup') {
    const fragment = String(body.fragment ?? '').toLowerCase()
    if (fragment.length < 8) return sendJson(res, 422, { error: 'fragment_too_short' })
    // hash fragment lookup — never plaintext
    const { listGiftsByHashPrefix } = await import('./admin-store')
    const rows = await listGiftsByHashPrefix(fragment)
    return sendJson(res, 200, { gifts: rows })
  }

  const gift = giftId ? await getGift(giftId) : null
  if (!gift) return sendJson(res, 404, { error: 'not_found' })

  if (action === 'void') {
    if (gift.status !== 'pending_payment' && gift.status !== 'paid' && gift.status !== 'sent') {
      return sendJson(res, 409, { error: 'cannot_void', status: gift.status })
    }
    gift.status = 'voided'
    gift.events.push({ t: Date.now(), event: 'voided' })
    await putGift(gift)
    auditGift({ event: 'gift_voided', giftId, admin: true })
    return sendJson(res, 200, { ok: true, status: 'voided' })
  }

  if (action === 'refund') {
    // support-only, 30-day rule, unredeemed
    if (gift.status === 'redeemed') return sendJson(res, 409, { error: 'already_redeemed' })
    if (gift.status === 'refunded') return sendJson(res, 200, { ok: true, already: true })
    const age = Date.now() - gift.createdAt
    if (age < THIRTY_DAYS_MS) {
      return sendJson(res, 409, { error: 'too_recent', retryAfterDays: Math.ceil((THIRTY_DAYS_MS - age) / 86400000) })
    }
    gift.status = 'refunded'
    gift.refundedAt = Date.now()
    gift.events.push({ t: Date.now(), event: 'refunded_support' })
    await putGift(gift)
    auditGift({ event: 'gift_refunded', giftId, admin: true, ageDays: Math.round(age / 86400000) })
    return sendJson(res, 200, { ok: true, status: 'refunded' })
  }

  if (action === 'resend') {
    gift.deliveryToken = crypto.randomBytes(18).toString('base64url')
    gift.events.push({ t: Date.now(), event: 'resent_admin' })
    await putGift(gift)
    auditGift({ event: 'gift_resent_admin', giftId })
    return sendJson(res, 200, { ok: true, deliveryToken: gift.deliveryToken })
  }

  sendJson(res, 422, { error: 'unknown_action' })
})
