/**
 * POST /api/checkout/convert-account — post-purchase guest → account nudge.
 *
 * The money has already moved: the eSIM sits in guestOrders/{email}. This
 * endpoint creates a real Firebase Auth account with the buyer's email +
 * chosen password and moves the order doc to users/{uid}/orders so it shows
 * up in the app's My eSIMs on next sign-in.
 *
 * Body: { email, password, orderId? }
 */
import { withApi, sendJson } from '../lib/http'
import { adminAuth, adminDb } from '../lib/firebase-admin'

function normalizeEmail(email: string): string {
  return email.toLowerCase().replace(/[^a-z0-9]/g, '_')
}

export default withApi(async (body, _req, res) => {
  const email = String(body.email ?? '').trim().toLowerCase()
  const password = String(body.password ?? '')
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    sendJson(res, 400, { error: 'invalid_email' })
    return
  }
  if (password.length < 8) {
    sendJson(res, 400, { error: 'weak_password' })
    return
  }

  const auth = await adminAuth()
  if (!auth) {
    sendJson(res, 503, { error: 'auth_unavailable' })
    return
  }

  let user: { uid: string }
  try {
    user = await auth.createUser({ email, password, emailVerified: false })
  } catch (err: any) {
    if (err?.code === 'auth/email-already-exists') {
      sendJson(res, 409, { error: 'email_in_use' })
      return
    }
    console.warn('[checkout/convert-account] createUser failed:', err?.code ?? err)
    sendJson(res, 500, { error: 'create_failed' })
    return
  }

  // Move every guest order for this email into the new account.
  const db = await adminDb()
  let moved = 0
  if (db) {
    try {
      const snap = await db
        .collection('guestOrders').doc(normalizeEmail(email))
        .collection('orders').get()
      for (const doc of snap.docs) {
        await db.collection('users').doc(user.uid)
          .collection('orders').doc(doc.id).set(doc.data())
        await doc.ref.delete()
        moved++
      }
    } catch (err) {
      console.warn('[checkout/convert-account] order move failed:', err)
      // The account exists; order move can be retried by support — not fatal.
    }
  }

  sendJson(res, 200, { ok: true, uid: user.uid, moved })
})
