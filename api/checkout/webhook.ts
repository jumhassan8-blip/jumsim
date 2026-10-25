/**
 * POST /api/checkout/webhook — Stripe → fulfilment for jumesim.com.
 *
 * Events: payment_intent.succeeded
 *
 *   1. Verify the Stripe signature (STRIPE_WEBHOOK_SECRET) — raw body.
 *   2. Idempotent: a processed payment_intent id short-circuits (ledger row
 *      in checkoutIntents/{piId}).
 *   3. Fulfil through the ACTIVE PROVIDER (PROVIDER env — eSIM Access by
 *      default, eSIM Go behind PROVIDER=esimg). The provider adapter holds
 *      all provider-specific logic; this handler is provider-agnostic.
 *   4. Write users/{uid}/orders/{orderId} with the install payload —
 *      the app listens on this path, so the eSIM appears in My eSIMs
 *      within seconds. Guest checkout (no uid) also writes
 *      guestOrders/{email} for later email re-association.
 *      eSIM Access provisions async (3–10s): when the install payload is
 *      not ready we write status 'processing' and the provider ORDER_STATUS
 *      webhook (api/webhooks/esimaccess) completes the doc. eSIM Go returns
 *      the payload inline.
 *   5. If the provider order FAILS after payment: the customer was CHARGED
 *      and we owe them. We do NOT auto-refund (anti-cheat rule: refunds are
 *      user-requested only, never automatic). Instead the ledger moves to
 *      'needsResolution' and support is alerted to refund manually — the
 *      customer can also request the refund themselves from the success
 *      page's fail state (same POST /api/refund/execute path).
 *
 * Order docs carry `esimTranNo` as the PRIMARY provider key (iccid is a
 * secondary install identifier) so usage/topUp/cancel stay provider-agnostic.
 */
import { sendJson, corsOrigin } from '../lib/http'
import { adminDb } from '../lib/firebase-admin'
import { getProvider } from '../providers'
import type { InstallPayload } from '../providers'

export const config = { api: { bodyParser: false } }

async function readRaw(req: import('node:http').IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  return Buffer.concat(chunks)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** eSIM Access provisions in 3–10s — poll briefly for the fast path. */
async function pollForPayload(providerOrderNo: string, attempts = 2, delayMs = 3000): Promise<InstallPayload | null> {
  const provider = getProvider()
  for (let i = 0; i < attempts; i++) {
    await sleep(delayMs)
    const payload = await provider.installPayload(providerOrderNo)
    if (payload) return payload
  }
  return null
}

export default async function handler(
  req: import('node:http').IncomingMessage,
  res: import('node:http').ServerResponse,
): Promise<void> {
  const origin = corsOrigin(req)
  if (origin) res.setHeader('Access-Control-Allow-Origin', origin)
  if (req.method === 'OPTIONS') {
    res.statusCode = 204
    res.end()
    return
  }

  const secret = process.env.STRIPE_SECRET_KEY
  // STRIPE_WEBHOOK_SECRET preferred; NEXT_STRIPE_WEBHOOK_SECRET accepted so
  // one env name works across deployments (value identical either way).
  const whSecret =
    process.env.STRIPE_WEBHOOK_SECRET ?? process.env.NEXT_STRIPE_WEBHOOK_SECRET
  if (!secret || !whSecret) {
    sendJson(res, 503, { error: 'webhook_not_configured' })
    return
  }

  const raw = await readRaw(req)
  const { default: Stripe } = await import('stripe')
  const stripe = new Stripe(secret)
  let event: import('stripe').Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(raw, req.headers['stripe-signature'] as string, whSecret)
  } catch (err) {
    console.warn('[checkout/webhook] signature verification failed:', err)
    sendJson(res, 400, { error: 'invalid_signature' })
    return
  }

  if (event.type !== 'payment_intent.succeeded') {
    sendJson(res, 200, { received: true, ignored: event.type })
    return
  }

  /* ── GIFT PAYMENTS (brief §3): the webhook is the SOLE truth — the
   * recipient's code is delivered ONLY after payment_intent.succeeded.
   * Kind discriminator lives in the intent metadata. ─────────────── */
  const mdKind = String((event.data.object as import('stripe').Stripe.PaymentIntent).metadata?.kind ?? '')
  if (mdKind === 'gift') {
    const { handleGiftPaymentSucceeded } = await import('../gift/webhook-handler')
    await handleGiftPaymentSucceeded(event.data.object as import('stripe').Stripe.PaymentIntent)
    sendJson(res, 200, { received: true, gift: true })
    return
  }

  const pi = event.data.object as import('stripe').Stripe.PaymentIntent
  const md = pi.metadata ?? {}
  const planId = String(md.planId ?? '')
  const uid = md.uid ? String(md.uid) : null
  const email = md.email ? String(md.email) : pi.receipt_email ?? null
  const topUpFor = md.topUpFor ? String(md.topUpFor) : null

  const db = await adminDb()
  if (!db) {
    console.error('[checkout/webhook] FIREBASE_SERVICE_ACCOUNT missing — cannot fulfil')
    sendJson(res, 500, { error: 'fulfilment_unavailable' })
    return
  }

  // idempotency: already processed?
  const ledgerRef = db.collection('checkoutIntents').doc(pi.id)
  const ledger = await ledgerRef.get()
  if (ledger.exists && ledger.data()?.status === 'fulfilled') {
    sendJson(res, 200, { received: true, duplicate: true })
    return
  }

  const orderId = `web_${pi.id.replace(/^pi_/, '')}`
  const provider = getProvider()
  const reference = `jum_${orderId}`

  // ── fulfil: active provider order → Firestore ───────────────────────
  try {
    if (!email) throw new Error('no_email_on_intent')
    const created = await provider.createOrder({ planId, email, reference })

    // top-up payments attach data to the base eSIM (esimTranNo-keyed)
    if (topUpFor) {
      try {
        const base = uid
          ? (await db.collection('users').doc(uid).collection('orders').where('iccid', '==', topUpFor).limit(1).get()).docs[0]?.data()
          : null
        const esimTranNo = base?.esimTranNo ?? null
        if (esimTranNo) await provider.topUp({ esimTranNo, planId, reference: `${reference}_topup` })
      } catch (topUpErr) {
        // the order is bought and paid — log; support can re-apply the top-up
        console.error('[checkout/webhook] topUp apply failed:', topUpErr)
      }
    }

    let payload = created.payload
    if (!payload) payload = await pollForPayload(created.providerOrderNo)

    const baseDoc = {
      orderId,
      planId,
      provider: provider.name,
      providerOrderNo: created.providerOrderNo,
      email,
      uid,
      topUpFor,
      paymentIntentId: pi.id,
      amountCents: pi.amount_received,
      currency: pi.currency,
      createdAt: Date.now(),
      source: 'web_checkout',
    }

    if (!payload) {
      // async provisioning — the provider ORDER_STATUS webhook completes
      // the doc (qr/lpa + status 'active'); the success page keeps polling.
      const processingDoc = { ...baseDoc, status: 'processing' }
      if (uid) {
        await db.collection('users').doc(uid).collection('orders').doc(orderId).set(processingDoc)
      }
      if (email) {
        const key = email.toLowerCase().replace(/[^a-z0-9]/g, '_')
        await db.collection('guestOrders').doc(key).collection('orders').doc(orderId).set(processingDoc)
      }
      await ledgerRef.set(
        { status: 'fulfilling', orderId, providerOrderNo: created.providerOrderNo, at: Date.now() },
        { merge: true },
      )
      console.log(`[checkout/webhook] ${orderId} provisioning via ${provider.name} (${created.providerOrderNo})`)
      sendJson(res, 200, { received: true, orderId, status: 'processing' })
      return
    }

    const orderDoc = {
      ...baseDoc,
      iccid: payload.iccid,
      // PRIMARY provider key — prefer esimTranNo over iccid everywhere
      esimTranNo: payload.esimTranNo || payload.iccid,
      qrUrl: payload.qrUrl,
      lpaString: payload.lpaString,
      smdpAddress: payload.smdpAddress,
      matchingId: payload.matchingId,
      status: 'active',
      expiresAt: payload.expiresAt ?? null,
    }
    if (uid) {
      await db.collection('users').doc(uid).collection('orders').doc(orderId).set(orderDoc)
    }
    if (email) {
      const key = email.toLowerCase().replace(/[^a-z0-9]/g, '_')
      await db.collection('guestOrders').doc(key).collection('orders').doc(orderId).set(orderDoc)
    }
    await ledgerRef.set(
      { status: 'fulfilled', orderId, fulfilledAt: Date.now() },
      { merge: true },
    )
    console.log(`[checkout/webhook] fulfilled ${orderId} (${planId}) via ${provider.name}`)
    sendJson(res, 200, { received: true, orderId })
  } catch (err) {
    // ── fulfilment failed after payment → needsResolution, NO auto-refund ──
    // Anti-cheat rule: refunds are user-requested only. The customer was
    // charged; support refunds the PI manually (or the user requests it via
    // POST /api/refund/execute — same path, provider cancel is a no-op on a
    // never-created eSIM). Either way: alert, ledger, failed status.
    console.error('[checkout/webhook] fulfilment failed after payment:', err)
    try {
      const { alertAdmin } = await import('../lib/guarantee')
      await alertAdmin({
        alertType: 'fulfilment_failed_needs_refund',
        orderId,
        detail: `Payment ${pi.id} (${planId}) captured but provider order failed: ${String(err)}. ` +
          'Customer was charged — refund the Stripe PI manually or guide the user to Request refund.',
      })
      await ledgerRef.set(
        { status: 'needsResolution', failedAt: Date.now(), error: String(err) },
        { merge: true },
      )
      const failDoc = {
        orderId,
        planId,
        provider: provider.name,
        status: 'failed_needs_refund',
        paymentIntentId: pi.id,
        createdAt: Date.now(),
        source: 'web_checkout',
      }
      if (uid) {
        await db.collection('users').doc(uid).collection('orders').doc(orderId).set(failDoc, { merge: true })
      }
      if (email) {
        const key = email.toLowerCase().replace(/[^a-z0-9]/g, '_')
        await db.collection('guestOrders').doc(key).collection('orders').doc(orderId).set(failDoc, { merge: true })
      }
    } catch (resolutionErr) {
      console.error('[checkout/webhook] resolution marking failed:', resolutionErr)
    }
    sendJson(res, 200, { received: true, needsResolution: true })
  }
}
