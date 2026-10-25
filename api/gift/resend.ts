/**
 * POST /api/gift/resend — re-deliver a sent gift's delivery link (brief §2C).
 * Sender-only; audit-logged. Regenerates the delivery token so the old
 * link dies (sender initiated → treat as a credential refresh).
 */
import { withApi, sendJson } from '../lib/http'
import { giftCtx } from './shared'
import { auditGift, getGift, putGift } from '../lib/gift-store'
import crypto from 'node:crypto'

export default withApi(async (body, req, res) => {
  const ctx = await giftCtx(req)
  const uid = ctx.uid ?? (typeof body.uid === 'string' ? body.uid : null)
  if (!uid) return sendJson(res, 401, { error: 'auth_required' })
  const id = typeof body.giftId === 'string' ? body.giftId : ''
  const gift = await getGift(id)
  if (!gift || gift.senderUid !== uid) return sendJson(res, 404, { error: 'not_found' })
  if (gift.status !== 'sent' && gift.status !== 'redeemed') {
    return sendJson(res, 409, { error: 'not_sent_yet' })
  }
  gift.deliveryToken = crypto.randomBytes(18).toString('base64url')
  gift.events.push({ t: Date.now(), event: 'resent' })
  await putGift(gift)
  auditGift({ event: 'gift_resent', giftId: id, uid })
  sendJson(res, 200, {
    ok: true,
    deliveryLink: `https://jumesim.com/redeem?t=${gift.deliveryToken}`,
    deliveryToken: gift.deliveryToken,
  })
})
