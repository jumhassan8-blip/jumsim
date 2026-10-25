/**
 * POST /api/gift/deliver-due — scheduler for SCHEDULED gifts (brief §3).
 * Cron hits this with the server-to-server token. Fires due gifts
 * (scheduledAt <= now, status paid) → sent. Idempotent: a sent gift is
 * never re-sent. Accepts an optional `now` override for tests.
 */
import { withApi, sendJson } from '../lib/http'
import { authenticate } from '../lib/auth'
import { auditGift, listScheduledDue, putGift } from '../lib/gift-store'

export default withApi(async (body, req, res) => {
  const auth = await authenticate(req)
  if (!auth || auth.kind !== 'server') return sendJson(res, 401, { error: 'unauthorized' })

  const now = Number(body.now) > 0 ? Number(body.now) : Date.now()
  const due = await listScheduledDue(now)
  let sent = 0
  for (const gift of due) {
    // re-check inside the loop — idempotency under concurrent ticks
    if (gift.status !== 'paid') continue
    gift.status = 'sent'
    gift.sentAt = Date.now()
    gift.events.push({ t: Date.now(), event: 'sent_scheduled' })
    await putGift(gift)
    auditGift({ event: 'gift_scheduled_sent', giftId: gift.id })
    sent += 1
  }
  sendJson(res, 200, { ok: true, due: due.length, sent })
})
