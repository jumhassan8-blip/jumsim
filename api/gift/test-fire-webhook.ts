/**
 * POST /api/gift/test-fire-webhook — SANDBOX ONLY.
 * Invokes the real gift webhook handler (the same code Stripe's
 * payment_intent.succeeded dispatches to) with the gift's recorded
 * PaymentIntent id. Exists so the acceptance suite can exercise
 * "webhook = sole truth" without live Stripe keys. Requires:
 *   - GIFT_MOCK_PAYMENTS=1 (mock mode; refuses otherwise)
 *   - Bearer PROVIDER_SETUP_TOKEN (server-to-server)
 */
import { withApi, sendJson } from '../lib/http'
import { authenticate } from '../lib/auth'
import { getGift } from '../lib/gift-store'

export default withApi(async (body, req, res) => {
  if (process.env.GIFT_MOCK_PAYMENTS !== '1') {
    return sendJson(res, 404, { error: 'not_found' })
  }
  const auth = await authenticate(req)
  if (!auth || auth.kind !== 'server') return sendJson(res, 401, { error: 'unauthorized' })

  const giftId = typeof body.giftId === 'string' ? body.giftId : ''
  const gift = giftId ? await getGift(giftId) : null
  if (!gift || !gift.paymentIntentId) return sendJson(res, 404, { error: 'not_found' })

  const { handleGiftPaymentSucceeded } = await import('./webhook-handler')
  await handleGiftPaymentSucceeded({
    id: gift.paymentIntentId,
    metadata: {
      kind: 'gift',
      giftId: gift.id,
      type: gift.type,
      amount: String(gift.amount),
      senderUid: gift.senderUid ?? '',
    },
  } as never)

  sendJson(res, 200, { ok: true, giftId: gift.id, status: gift.status })
})
