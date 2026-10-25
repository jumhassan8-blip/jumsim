/**
 * POST /api/gift/mine — My Gifts (brief §2C): status chips filter on the
 * client; rows carry recipient, amount, status, and a RESEND action
 * (server: /api/gift/resend).
 */
import { withApi, sendJson } from '../lib/http'
import { giftCtx } from './shared'
import { listGiftsForSender } from '../lib/gift-store'
import { priceUsdFor } from './create'

export default withApi(async (body, req, res) => {
  const ctx = await giftCtx(req)
  const uid = ctx.uid ?? (typeof body.uid === 'string' ? body.uid : null)
  if (!uid) return sendJson(res, 401, { error: 'auth_required' })
  const gifts = (await listGiftsForSender(uid)).map((g) => ({
    id: g.id,
    type: g.type,
    amount: g.amount,
    unit: g.unit,
    recipientName: g.recipient.name,
    recipientEmail: g.recipient.email,
    recipientWhatsapp: g.recipient.whatsapp,
    message: g.message,
    status: g.status,
    delivery: g.delivery,
    scheduledAt: g.scheduledAt,
    createdAt: g.createdAt,
    sentAt: g.sentAt,
    redeemedAt: g.redeemedAt,
    refundedAt: g.refundedAt,
    deliveryToken: g.deliveryToken,
    priceUsd: priceUsdFor(g.type, g.amount) ?? g.amount,
  }))
  sendJson(res, 200, { gifts })
})
