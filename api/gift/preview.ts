/**
 * POST /api/gift/preview — show the conversion BEFORE the user confirms
 * redemption (brief §5). Reveals only what the code WOULD apply; it does
 * NOT consume the code. Guess attempts are NOT counted for a well-formed
 * preview (that would let a bot burn a victim's lockout); format-invalid
 * previews are rejected without lookup.
 */
import { withApi, sendJson } from '../lib/http'
import { giftCtx } from './shared'
import { getGiftByCodeHash, hashGiftCode, isCodeFormat, normalizeCodeInput } from '../lib/gift-store'
import { getRedemption } from '../lib/gift-store'
import { priceUsdFor } from './create'

export default withApi(async (body, req, res) => {
  void (await giftCtx(req))
  const raw = typeof body.code === 'string' ? body.code : ''
  if (!isCodeFormat(raw)) return sendJson(res, 422, { error: 'invalid_format' })

  const hash = hashGiftCode(normalizeCodeInput(raw))
  if (getRedemption(hash)) {
    return sendJson(res, 409, { error: 'already_redeemed' })
  }
  const gift = await getGiftByCodeHash(hash)
  if (!gift || (gift.status !== 'sent' && gift.status !== 'paid')) {
    return sendJson(res, 404, { error: 'invalid_code' })
  }
  const valueUsd = gift.type === 'football_pro'
    ? null
    : (priceUsdFor(gift.type, gift.amount) ?? gift.amount)
  sendJson(res, 200, {
    ok: true,
    type: gift.type,
    amount: gift.amount,
    unit: gift.unit,
    recipientName: gift.recipient.name,
    message: gift.message,
    valueUsd,
    conversion: gift.type === 'football_pro'
      ? `${gift.amount} month(s) of Football PRO`
      : gift.type === 'jum_credit'
        ? `$${valueUsd?.toFixed(2)} — redeemable as e-SIM Balance or Football PRO/coins`
        : `$${valueUsd?.toFixed(2)} e-SIM Balance`,
  })
})
