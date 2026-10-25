/**
 * POST /api/webhooks/esimaccess — eSIM Access order-status notifications.
 *
 * eSIM Access provisions eSIMs async: the checkout webhook writes the
 * order doc with status 'processing', and THIS webhook completes it when
 * the eSIM is provisioned. Per the provider docs we re-query their API
 * for the truth (the ORDER_STATUS payload doesn't carry the ICCID) —
 * never trust the notification body for install data.
 *
 * Security:
 *   - sender IP whitelist (provider's published webhook IPs; override or
 *     disable with ESIMA_WEBHOOK_IPS="a,b,c" / ESIMA_WEBHOOK_STRICT_IPS=0)
 *   - optional shared-secret header when ESIMA_WEBHOOK_SECRET is set
 *
 * Event types (provider docs): ORDER_STATUS, ESIM_STATUS, SMDP_EVENT,
 * DATA_USAGE, VALIDITY_USAGE, CHECK_HEALTH.
 */
import { sendJson, readJson, assertPost } from '../lib/http'
import { adminDb } from '../lib/firebase-admin'
import { getProvider } from '../providers'
import type { InstallPayload } from '../providers'

const DEFAULT_SENDER_IPS = ['3.1.131.226', '54.254.74.88', '18.136.190.97', '18.136.60.197', '18.136.19.137']

function senderAllowed(req: import('node:http').IncomingMessage): boolean {
  if (process.env.ESIMA_WEBHOOK_STRICT_IPS === '0') return true
  const ips = (process.env.ESIMA_WEBHOOK_IPS ?? DEFAULT_SENDER_IPS.join(','))
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  // honor x-forwarded-first for proxied deployments, fall back to socket
  const fwd = req.headers['x-forwarded-for']
  const ip = (typeof fwd === 'string' ? fwd.split(',')[0].trim() : '') || req.socket.remoteAddress || ''
  const normalized = ip.replace(/^::ffff:/, '')
  return ips.includes(normalized)
}

/** best-effort audit trail; the guarantee engine can replay from here */
async function recordRaw(event: Record<string, unknown>): Promise<void> {
  const db = await adminDb()
  if (!db) return
  try {
    await db.collection('providerWebhookEvents').add({ provider: 'esimaccess', at: Date.now(), ...event })
  } catch (err) {
    console.warn('[webhooks/esimaccess] audit write failed:', err)
  }
}

/**
 * ORDER_STATUS — the eSIM is provisioned. Look up the checkout ledger by
 * provider order number, re-query the install payload, complete the order
 * docs (users/{uid}/orders + guestOrders/{email}) idempotently.
 */
async function completeOrder(orderNo: string): Promise<{ completed: boolean; reason?: string }> {
  const db = await adminDb()
  if (!db) return { completed: false, reason: 'no_db' }
  const provider = getProvider()

  const ledgerSnap = await db
    .collection('checkoutIntents')
    .where('providerOrderNo', '==', orderNo)
    .limit(1)
    .get()
    .catch(() => null)
  const ledgerDoc = ledgerSnap?.docs[0]
  if (!ledgerDoc) return { completed: false, reason: 'unknown_order' }

  // idempotent: already delivered
  const ledger = ledgerDoc.data()
  if (ledger.status === 'fulfilled') return { completed: true, reason: 'duplicate' }

  let payload: InstallPayload | null = null
  try {
    payload = await provider.installPayload(orderNo)
  } catch (err) {
    return { completed: false, reason: `query_failed:${String(err)}` }
  }
  if (!payload) return { completed: false, reason: 'still_provisioning' }

  const patch = {
    iccid: payload.iccid,
    esimTranNo: payload.esimTranNo || payload.iccid,
    qrUrl: payload.qrUrl,
    lpaString: payload.lpaString,
    smdpAddress: payload.smdpAddress,
    matchingId: payload.matchingId,
    status: 'active',
    expiresAt: payload.expiresAt ?? null,
    deliveredVia: 'esimaccess_webhook',
    deliveredAt: Date.now(),
  }

  const orderId = String(ledger.orderId ?? '')
  const uid = ledger.uid ? String(ledger.uid) : null
  const email = ledger.email ? String(ledger.email) : null
  if (orderId) {
    if (uid) {
      await db.collection('users').doc(uid).collection('orders').doc(orderId).set(patch, { merge: true })
    }
    if (email) {
      const key = email.toLowerCase().replace(/[^a-z0-9]/g, '_')
      await db.collection('guestOrders').doc(key).collection('orders').doc(orderId).set(patch, { merge: true })
    }
  }
  await ledgerDoc.ref.set({ status: 'fulfilled', fulfilledAt: Date.now(), deliveredVia: 'esimaccess_webhook' }, { merge: true })
  return { completed: true }
}

/** usage/status events: stamp the latest provider state on matching orders */
async function applyStatusEvent(esimTranNo: string, event: Record<string, unknown>): Promise<void> {
  const db = await adminDb()
  if (!db || !esimTranNo) return
  try {
    const snap = await db.collectionGroup('orders').where('esimTranNo', '==', esimTranNo).limit(20).get()
    const usedBytes = Number(event.usedVolume ?? event.orderUsage ?? event.usage ?? NaN)
    const status = String(event.esimStatus ?? event.smdpStatus ?? event.status ?? '').toLowerCase() || undefined
    const patch: Record<string, unknown> = { lastProviderEventAt: Date.now() }
    if (Number.isFinite(usedBytes) && usedBytes >= 0) patch.usedBytes = usedBytes
    if (status) patch.providerStatus = status
    for (const doc of snap.docs) await doc.ref.set(patch, { merge: true })
  } catch (err) {
    console.warn('[webhooks/esimaccess] status apply failed:', err)
  }
}

export default async function handler(
  req: import('node:http').IncomingMessage,
  res: import('node:http').ServerResponse,
): Promise<void> {
  if (!assertPost(req, res)) return

  if (!senderAllowed(req)) {
    sendJson(res, 403, { error: 'sender_not_allowed' })
    return
  }
  const shared = process.env.ESIMA_WEBHOOK_SECRET
  if (shared && req.headers['x-jum-webhook-secret'] !== shared) {
    sendJson(res, 401, { error: 'invalid_shared_secret' })
    return
  }

  let body: Record<string, unknown>
  try {
    body = await readJson(req)
  } catch {
    sendJson(res, 400, { error: 'invalid_json' })
    return
  }

  // defensive parsing — the exact envelope isn't in the public reference
  const inner = (body.obj ?? body.data ?? body) as Record<string, unknown>
  const type = String(body.type ?? body.eventType ?? body.notice ?? inner.type ?? '').toUpperCase()
  const orderNo = String(body.orderNo ?? inner.orderNo ?? '')
  const esimTranNo = String(body.esimTranNo ?? inner.esimTranNo ?? inner.esim_tran_no ?? '')

  await recordRaw({ type, orderNo, esimTranNo, body })

  switch (type) {
    case 'CHECK_HEALTH':
      sendJson(res, 200, { received: true, health: 'ok' })
      return
    case 'ORDER_STATUS': {
      if (!orderNo) {
        sendJson(res, 400, { error: 'missing_order_no' })
        return
      }
      const r = await completeOrder(orderNo)
      sendJson(res, 200, { received: true, ...r })
      return
    }
    case 'ESIM_STATUS':
    case 'SMDP_EVENT':
    case 'DATA_USAGE':
    case 'VALIDITY_USAGE':
      await applyStatusEvent(esimTranNo, { ...body, ...inner })
      sendJson(res, 200, { received: true })
      return
    default:
      // unknown event type — ack so the provider doesn't retry-flood us
      sendJson(res, 200, { received: true, ignored: type || 'untyped' })
  }
}
