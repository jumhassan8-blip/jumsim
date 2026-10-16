import { withApi, sendJson } from '../lib/http'
import { adminDb } from '../lib/firebase-admin'

/**
 * POST /api/auth/reassociate
 * body: { email, uid }
 *
 * Backup restore path (Module 16 §4): guest checkouts stamp the anonymous
 * device uid onto the order, but orders placed before sign-in (or on a
 * device that was reset) may have no uid at all. The Admin SDK bypasses
 * Firestore rules, finds server orders whose delivery email matches the
 * account and have no uid, and re-associates them to users/{uid}/orders.
 *
 * No service account configured → 501; the client treats that as
 * "nothing restored", never a crash.
 */
export default withApi(async (body, _req, res) => {
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const uid = typeof body.uid === 'string' ? body.uid.trim() : ''
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return sendJson(res, 400, { error: 'invalid_email' })
  }
  if (!uid) return sendJson(res, 400, { error: 'invalid_uid' })

  const db = await adminDb()
  if (!db) return sendJson(res, 501, { error: 'admin_not_configured' })

  // server order store: order docs keyed by orderId (see lib/orders.ts).
  // Re-association target: any stored order with this delivery email and
  // no uid stamp yet.
  const snap = await db.collection('orders').where('email', '==', email).get()
  let moved = 0
  const batch = db.batch()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  snap.forEach((doc: any) => {
    const data = doc.data() as { uid?: string }
    if (data.uid) return
    batch.set(db.doc(`users/${uid}/orders/${doc.id}`), { ...data, uid })
    batch.update(doc.ref, { uid })
    moved++
  })
  if (moved > 0) {
    await batch.commit()
    console.log(JSON.stringify({ type: 'analytics', event: 'orders_restored', email, uid, count: moved }))
  }
  return sendJson(res, 200, { moved })
})
