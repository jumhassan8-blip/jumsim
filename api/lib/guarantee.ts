/**
 * Refund window + admin alerting. NO AUTO-REFUND.
 *
 * The anti-cheat refund is USER-REQUESTED ONLY (POST /api/refund/execute):
 * the eSIM is terminated at the SUPPLIER first (screenshots are unstoppable
 * — supplier cancellation is the kill switch), Stripe refunds second. There
 * is no cron, no timer, no scheduled refund anywhere in the codebase.
 *
 * GUARANTEE_WINDOW_MS is the 10-minute window in which a user-requested
 * refund may be attempted. The countdown on the client is display only —
 * the server re-checks the window, live usage, and supplier status at
 * execute time before ANY money moves.
 */
import { getOrder, putOrder } from './orders'

export const GUARANTEE_WINDOW_MS = 10 * 60 * 1000

export function windowOpenFor(
  order: { guaranteeEndsAt?: number; createdAt: number; status?: string; refund?: unknown; terminatedAt?: number },
  now: number,
): boolean {
  // a refunded/terminated order never re-opens its window
  if (order.refund || order.status === 'refunded_terminated' || order.terminatedAt) return false
  const end = order.guaranteeEndsAt ?? order.createdAt + GUARANTEE_WINDOW_MS
  return now < end
}

export interface AdminAlert {
  /** alert kind — discriminates the notification subject/body */
  alertType: string
  at: number
  orderId?: string
  detail: string
}

/**
 * Alert the ops team. Prefer SendGrid when SENDGRID_API_KEY is set; the
 * alert is ALSO written to adminAlerts (fire-and-forget) and always logged
 * so a missing mail key never silences an alert.
 */
export async function alertAdmin(alert: Omit<AdminAlert, 'at'>): Promise<void> {
  const full: AdminAlert = { ...alert, at: Date.now() }
  console.error(JSON.stringify({ type: 'admin_alert', ...full }))
  const { adminDb } = await import('./firebase-admin')
  const db = await adminDb()
  if (db) {
    try {
      await db.collection('adminAlerts').add(full)
    } catch (err) {
      console.warn('[admin] alert write failed:', err)
    }
  }
  const key = process.env.SENDGRID_API_KEY
  if (!key) return
  try {
    await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: { email: 'support@jumesim.com', name: 'Jum e-SIM Ops' },
        reply_to: { email: 'support@jumesim.com' },
        personalizations: [{ to: [{ email: process.env.ADMIN_EMAIL ?? 'support@jumesim.com' }] }],
        subject: `[Jum e-SIM] ${alert.alertType}`,
        content: [{ type: 'text/plain', value: `${alert.alertType}\n\n${alert.detail}\n\norder: ${alert.orderId ?? 'n/a'}\nat: ${new Date(full.at).toISOString()}` }],
      }),
    }).catch(() => {})
  } catch {
    /* alerting must never throw */
  }
}

/** durable per-order event log (idempotency + audit replay) */
export async function recordOrderEvent(
  orderId: string,
  event: string,
  data?: Record<string, unknown>,
): Promise<void> {
  const order = await getOrder(orderId)
  if (!order) return
  order.events = [...(order.events ?? []), { at: Date.now(), event, data }]
  await putOrder(order)
}
