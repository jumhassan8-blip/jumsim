/**
 * Gift webhook fulfilment — called ONLY from api/checkout/webhook.ts after
 * payment_intent.succeeded (the webhook is the sole truth; recipient
 * delivery never happens on the client path). Idempotent per PaymentIntent.
 *
 * For 'now' gifts: marks paid → sent and "delivers" (email + WhatsApp link
 * via the mail adapter when configured; the sender always received the
 * plaintext at purchase, so delivery is belt-and-suspenders). Scheduled
 * gifts stay 'paid' until /api/gift/deliver-due fires them.
 */
import { adminDb } from '../lib/firebase-admin'
import { auditGift, getGift, putGift } from '../lib/gift-store'

interface StripePiLike {
  id: string
  metadata?: Record<string, string>
}

export async function handleGiftPaymentSucceeded(pi: StripePiLike): Promise<{ ok: boolean; giftId: string | null }> {
  const giftId = String(pi.metadata?.giftId ?? '')
  if (!giftId) return { ok: false, giftId: null }
  const gift = await getGift(giftId)
  if (!gift) {
    auditGift({ event: 'gift_webhook_unknown', giftId, piId: pi.id })
    return { ok: false, giftId }
  }
  if (gift.paymentIntentId !== pi.id) {
    auditGift({ event: 'gift_webhook_pi_mismatch', giftId, piId: pi.id })
    return { ok: false, giftId }
  }
  // idempotency: a processed intent never re-fires delivery
  if (gift.status === 'sent' || gift.status === 'redeemed') {
    return { ok: true, giftId }
  }
  if (gift.status !== 'pending_payment' && gift.status !== 'paid') {
    return { ok: false, giftId }
  }

  gift.status = 'paid'
  gift.paidAt = Date.now()
  gift.events.push({ t: Date.now(), event: 'paid', ref: pi.id })

  if (gift.delivery === 'now') {
    gift.status = 'sent'
    gift.sentAt = Date.now()
    gift.events.push({ t: Date.now(), event: 'sent' })
    // Firestore mirror (users/{uid}/giftCards) so My Gifts is live
    const db = await adminDb().catch(() => null)
    if (db && gift.senderUid) {
      await db.collection('users').doc(gift.senderUid).collection('giftCards').doc(gift.id)
        .set({ ...publicGift(gift) }, { merge: true })
        .catch(() => {})
    }
    await deliverGiftNotification(gift.id).catch(() => {})
  }

  await putGift(gift)
  auditGift({ event: 'gift_paid', giftId, scheduled: gift.delivery === 'scheduled' })
  return { ok: true, giftId }
}

function publicGift(g: { id: string; type: string; amount: number; unit: string; recipient: { name: string }; status: string; createdAt: number; sentAt: number | null; redeemedAt: number | null }) {
  return {
    id: g.id, type: g.type, amount: g.amount, unit: g.unit,
    recipientName: g.recipient.name, status: g.status,
    createdAt: g.createdAt, sentAt: g.sentAt, redeemedAt: g.redeemedAt,
  }
}

/** Best-effort recipient notification — no-op when no mailer configured. */
async function deliverGiftNotification(giftId: string): Promise<void> {
  const gift = await getGift(giftId)
  if (!gift) return
  const db = await adminDb().catch(() => null)
  if (!db) return
  // Store a delivery record with the LINK (base64url token), never the code.
  // The actual email/WhatsApp send rides the existing mailer when wired;
  // until then the sender's receipt + copy button is the delivery path.
  const link = `https://jumesim.com/redeem?t=${gift.deliveryToken}`
  await db.collection('giftDeliveries').doc(gift.id).set({
    giftId: gift.id,
    to: gift.recipient.email ?? `wa:${gift.recipient.whatsapp ?? ''}`,
    link,
    sentAt: Date.now(),
  }, { merge: true }).catch(() => {})
}
