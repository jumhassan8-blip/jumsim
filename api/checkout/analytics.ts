/**
 * POST /api/checkout/analytics — funnel events from jumesim.com/checkout.
 * Fire-and-forget ingestion; failures never block the page.
 *
 * Events: checkout_viewed, method_selected, payment_success {method},
 *         guest_vs_account, delivery_viewed, web_checkout_started,
 *         web_payment_failed, web_order_created, install_instructions_emailed
 */
import { withApi, sendJson } from '../lib/http'
import { adminDb } from '../lib/firebase-admin'

const ALLOWED_EVENTS = new Set([
  'checkout_viewed',
  'method_selected',
  'payment_success',
  'guest_vs_account',
  'delivery_viewed',
  'web_checkout_started',
  'web_payment_failed',
  'web_order_created',
  'install_instructions_emailed',
])

export default withApi(async (body, _req, res) => {
  const event = String(body.event ?? '')
  const data = (body.data ?? {}) as Record<string, unknown>
  const at = Number(body.at ?? Date.now())
  if (!ALLOWED_EVENTS.has(event)) {
    sendJson(res, 400, { error: 'unknown_event' })
    return
  }
  const db = await adminDb()
  if (db) {
    try {
      await db.collection('checkoutAnalytics').add({ event, data, at })
    } catch (err) {
      console.warn('[checkout/analytics] write failed:', err)
    }
  }
  console.log('[analytics]', event, data)
  sendJson(res, 200, { ok: true })
})
