/**
 * POST /api/topup/status — order lifecycle truth.
 * { orderId } → TopUpOrder. Polls the provider when the local state is
 * still pending/processing; provider 'failed' flips the order to failed
 * and fires the auto-refund to the ORIGINAL pay path (balance or card —
 * card refunds go through Stripe by the caller of /api/refund/execute's
 * sibling logic; here we restore Balance immediately and flag card
 * orders for the standard refund pipeline via refundNeedsAttention).
 */
import { withApi, sendJson } from '../lib/http'
import { resolveTopUpProvider } from './index'
import { applyBalanceDelta, auditTopUp, getTopUp, putTopUp } from '../lib/topup-store'

export default withApi(async (body, _req, res) => {
  const orderId = typeof body.orderId === 'string' ? body.orderId : ''
  const order = orderId ? await getTopUp(orderId) : null
  if (!order) return sendJson(res, 404, { error: 'not_found' })

  if (order.status === 'pending' || order.status === 'processing') {
    const provider = resolveTopUpProvider()
    if (provider && order.providerRef) {
      const remote = await provider.status(order.providerRef).catch(() => null)
      if (remote && remote !== order.status) {
        if (remote === 'delivered') {
          order.status = 'delivered'
          order.events.push({ t: Date.now(), event: 'delivered' })
        } else if (remote === 'failed') {
          order.status = 'failed'
          order.failureReason = 'operator rejected number'
          order.events.push({ t: Date.now(), event: 'failed_auto_refund_started' })
          // AUTO-refund to the original path
          if (order.payPath === 'balance' && order.uid) {
            await applyBalanceDelta(order.uid, order.amountUsd + order.feeUsd, `topup-refund:${order.id}`)
            order.status = 'refunded'
            order.events.push({ t: Date.now(), event: 'refunded_to_balance' })
          } else {
            // card path — hand to the standard refund pipeline (flagged)
            order.events.push({ t: Date.now(), event: 'refund_pending_card' })
          }
          auditTopUp({
            uid: order.uid, msisdnHash: order.msisdnHash, productId: order.productId,
            amountUsd: order.amountUsd, providerRef: order.providerRef, outcome: 'failed_auto_refund',
          })
        }
        await putTopUp(order)
      }
    }
  }

  sendJson(res, 200, { order })
})
