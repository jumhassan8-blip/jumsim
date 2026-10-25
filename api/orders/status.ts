import { withApi, sendJson } from '../lib/http'
import { getOrder } from '../lib/orders'
import { windowOpenFor } from '../lib/guarantee'

/**
 * POST /api/orders/status
 * body: { orderIds: string[] }
 *
 * Per-order refund-eligibility state for the client: countdown anchor,
 * refunded_terminated terminal state, refund-in-progress lock. The client
 * renders the countdown/button from this and NEVER decides refundability —
 * POST /api/refund/execute re-verifies everything live (usage gate,
 * window, supplier termination) before any money moves.
 */
export default withApi(async (body, _req, res) => {
  const ids = Array.isArray(body.orderIds) ? body.orderIds.slice(0, 50) : []
  const out: Record<string, unknown> = {}
  const now = Date.now()
  for (const id of ids) {
    if (typeof id !== 'string' || !id) continue
    const o = await getOrder(id)
    if (!o) continue
    out[id] = {
      orderId: o.orderId,
      status: o.status,
      guaranteeEndsAt: o.guaranteeEndsAt ?? o.createdAt + 10 * 60 * 1000,
      windowOpen: windowOpenFor(o, now),
      refundInProgress: Boolean(o.refundInProgress),
      refundNeedsAttention: Boolean(o.refundNeedsAttention),
      refundedAt: o.refund?.executedAt ?? null,
      terminatedAt: o.terminatedAt ?? null,
      events: o.events ?? [],
    }
  }
  return sendJson(res, 200, { orders: out, serverNow: now })
})
