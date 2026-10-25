/**
 * POST /api/refund/execute { orderId }
 *
 * ANTI-CHEAT REFUND — user-requested only, terminate before money moves.
 *
 * Screenshots are unstoppable; supplier cancellation is the kill switch that
 * makes every copy of the QR/code dead. The sequence runs IN ORDER and aborts
 * on ANY failure:
 *
 *  STEP 1 — VERIFY UNUSED (gate, never mutates):
 *    Fresh provider call: profile NOT installed/activated AND zero bytes
 *    AND within the 10-minute window (server clock). Any failure → DENIED
 *    with a reason, zero side effects.
 *
 *  STEP 2 — TERMINATE AT SUPPLIER (anti-cheat kill):
 *    Cancel/deactivate the profile at the provider, then RE-QUERY status.
 *    Still active / cancellation failed → NO REFUND. "Our team will handle
 *    this" + admin alert. The order stays active and usable — we never take
 *    the eSIM AND keep the money ambiguity.
 *
 *  STEP 3 — ONLY AFTER CONFIRMED TERMINATION:
 *    Stripe refund to the original payment method (3 retries) →
 *    status 'refunded_terminated' + terminatedAt → purge the install payload
 *    (qrUrl/lpaString) so no copy of the code survives server-side.
 *
 * Idempotency: a refundInProgress lock answers concurrent requests with
 * "Refund in progress"; a completed refund answers idempotent success.
 */
import { withApi, sendJson } from '../lib/http'
import {
  getOrder,
  isMockMode,
  putOrder,
  resolveFirestoreOrder,
  type StoredOrder,
} from '../lib/orders'
import { verifyUnused, esimKeyFor } from '../lib/usage'
import { windowOpenFor, alertAdmin, recordOrderEvent, GUARANTEE_WINDOW_MS } from '../lib/guarantee'
import { getProvider } from '../providers'

export default withApi(async (body, _req, res) => {
  const orderId = typeof body.orderId === 'string' ? body.orderId.trim() : ''
  if (!orderId) return sendJson(res, 400, { error: 'missing_orderId' })

  // ── resolve the order: KV/memory store (in-app mock purchases) or the
  //    Firestore web-checkout docs, mirrored back for a uniform shape ────
  let order: StoredOrder | null = await getOrder(orderId)
  let fsRef: Awaited<ReturnType<typeof resolveFirestoreOrder>> = null
  if (!order) {
    fsRef = await resolveFirestoreOrder(orderId)
    if (fsRef) {
      const d = fsRef.data
      const purchase = (d.purchase ?? {}) as { order?: Record<string, unknown>; plan?: { priceUSD?: number } }
      order = {
        orderId,
        iccid: String(d.iccid ?? purchase.order?.iccid ?? ''),
        esimTranNo: String(d.esimTranNo ?? d.iccid ?? purchase.order?.iccid ?? ''),
        provider: (d.provider as StoredOrder['provider']) ?? 'esimaccess',
        providerOrderNo: String(d.providerOrderNo ?? ''),
        uid: d.uid ? String(d.uid) : undefined,
        email: String(d.email ?? purchase.order?.email ?? ''),
        qrUrl: String(d.qrUrl ?? purchase.order?.qrUrl ?? ''),
        lpaString: String(d.lpaString ?? purchase.order?.lpaString ?? ''),
        smdpAddress: String(d.smdpAddress ?? ''),
        matchingId: String(d.matchingId ?? ''),
        expiresAt: Number(d.expiresAt ?? 0),
        planId: String(d.planId ?? purchase.order?.planId ?? ''),
        createdAt: Number(d.createdAt ?? Date.now()),
        topUpFor: d.topUpFor ? String(d.topUpFor) : undefined,
        status: (d.status as StoredOrder['status']) ?? 'active',
        priceUSD: typeof d.amountCents === 'number' ? d.amountCents / 100 : (purchase.plan?.priceUSD ?? 0),
        paymentIntentId: d.paymentIntentId ? String(d.paymentIntentId) : undefined,
        guaranteeEndsAt: d.createdAt ? Number(d.createdAt) + GUARANTEE_WINDOW_MS : undefined,
        refundInProgress: Boolean(d.refundInProgress),
        terminatedAt: d.terminatedAt ? Number(d.terminatedAt) : undefined,
        refund: d.refund as StoredOrder['refund'],
        events: (d.events as StoredOrder['events']) ?? [],
      }
    }
  }
  if (!order) return sendJson(res, 404, { error: 'order_not_found' })

  // ── terminal / lock short-circuits (idempotent replays, double-tap race) ──
  if (order.status === 'refunded_terminated' && order.refund) {
    return sendJson(res, 200, {
      ok: true,
      status: 'refunded_terminated',
      amountUSD: order.refund.amountUSD,
      refundedAt: order.refund.executedAt,
      idempotent: true,
    })
  }
  if (order.refundInProgress) {
    return sendJson(res, 409, { error: 'refund_in_progress', message: 'Refund in progress' })
  }
  if (order.terminatedAt && !order.refund) {
    // terminated but the Stripe leg never landed — still owned by support
    return sendJson(res, 409, {
      error: 'refund_pending_manual',
      message: 'Your eSIM is deactivated; the refund is being finalized by our team.',
    })
  }

  /* ═══ STEP 1 — VERIFY UNUSED (gate) ═══════════════════════════════════ */
  // Runs in EVERY mode — in mock the usage registry stands in for the
  // supplier, so the gate, its denials and the analytics stay testable.
  const now = Date.now()
  let gateReading: { used: boolean; totalBytes: number; esimStatus: string } | null = null
  try {
    const gate = await verifyUnused(order)
    gateReading = gate.reading
    if (!gate.ok) {
      const reason = gate.reading.used || gate.reading.totalBytes > 0 ? 'in_use' : 'unknown'
      await recordOrderEvent(orderId, 'refund_denied_in_use', { reading: gate.reading })
      return sendJson(res, 200, {
        ok: false,
        reason,
        message: 'Already in use — no refund',
        detail: gate.reading,
      })
    }
  } catch (err) {
    await recordOrderEvent(orderId, 'refund_gate_error', { error: String(err) })
    return sendJson(res, 503, { error: 'gate_unavailable', message: 'Could not verify — try again in a moment' })
  }
  if (!windowOpenFor(order, now)) {
    await recordOrderEvent(orderId, 'refund_denied_window_expired', { now })
    return sendJson(res, 200, {
      ok: false,
      reason: 'window_expired',
      message: 'Window expired — contact support',
    })
  }

  // ── idempotency lock: the refund runs to completion or not at all ──────
  // Fresh re-read + write with no macrotask yield in between (the KV store
  // resolves in microtasks) — a concurrent request sees the lock the moment
  // it lands. Double-tap → 409 refund_in_progress.
  if (fsRef) {
    await (fsRef.ref as { update: (d: unknown) => Promise<unknown> }).update({ refundInProgress: true })
    order.refundInProgress = true
  } else {
    const fresh = await getOrder(orderId)
    if (!fresh) return sendJson(res, 404, { error: 'order_not_found' })
    if (fresh.refund || fresh.status === 'refunded_terminated') {
      return sendJson(res, 200, {
        ok: true,
        status: 'refunded_terminated',
        amountUSD: fresh.refund?.amountUSD,
        refundedAt: fresh.refund?.executedAt,
        idempotent: true,
      })
    }
    if (fresh.refundInProgress) {
      return sendJson(res, 409, { error: 'refund_in_progress', message: 'Refund in progress' })
    }
    fresh.refundInProgress = true
    await putOrder(fresh)
    order.refundInProgress = true
  }
  // mock: yield a macrotask so the lock window is observable — the live
  // path holds it across the supplier round-trip (cancel + re-query)
  if (isMockMode()) await new Promise((r) => setTimeout(r, 100))
  await recordOrderEvent(orderId, 'refund_gate_passed', { reading: gateReading })

  try {
    /* ═══ STEP 2 — TERMINATE AT SUPPLIER (anti-cheat kill) ═══════════════ */
    const provider = getProvider()
    const key = esimKeyFor(order)
    const releaseLock = async () => {
      order.refundInProgress = false
      if (fsRef) await (fsRef.ref as { update: (d: unknown) => Promise<unknown> }).update({ refundInProgress: false })
      else await putOrder(order)
    }
    // dev-only: MOCK_MODE + this header simulates a supplier-side
    // cancellation failure so the no-refund denial path can be tested
    const mockTerminateFail = isMockMode() && (_req.headers['x-mock-terminate-fail'] === '1')
    let terminated = false
    if (mockTerminateFail) {
      await releaseLock()
      await recordOrderEvent(orderId, 'refund_denied_cant_terminate', { simulated: true })
      await alertAdmin({
        alertType: 'refund_terminate_failed',
        orderId,
        detail: 'User-requested refund: supplier cancellation failed (simulated). No refund issued. Handle manually.',
      })
      return sendJson(res, 200, {
        ok: false,
        reason: 'cant_terminate',
        message: "Couldn't safely cancel — our team will handle this",
      })
    }
    if (!isMockMode()) {
      try {
        const cancel = await provider.cancel(key)
        if (!cancel.ok) throw new Error('cancel_rejected_state')
      } catch (err) {
        // release the lock so support can retry
        await releaseLock()
        await recordOrderEvent(orderId, 'refund_denied_cant_terminate', { error: String(err) })
        await alertAdmin({
          alertType: 'refund_terminate_failed',
          orderId,
          detail: `User-requested refund: supplier cancellation failed (${String(err)}). No refund issued. Handle manually.`,
        })
        return sendJson(res, 200, {
          ok: false,
          reason: 'cant_terminate',
          message: "Couldn't safely cancel — our team will handle this",
        })
      }
      // re-query: the kill switch must CONFIRM dead before any money moves
      try {
        await new Promise((r) => setTimeout(r, 1500))
        const payload = await provider.installPayload(order.providerOrderNo || key)
        const status = (payload?.status ?? '').toLowerCase()
        const dead = !payload || /deleted|cancelled|canceled|disabled|revoked/.test(status)
        if (!dead) throw new Error(`still_active:${status || 'unknown'}`)
        terminated = true
      } catch (err) {
        await releaseLock()
        await recordOrderEvent(orderId, 'refund_terminate_unconfirmed', { error: String(err) })
        await alertAdmin({
          alertType: 'refund_terminate_unconfirmed',
          orderId,
          detail: `Cancellation unconfirmed after re-query (${String(err)}). No refund issued. Verify supplier state manually.`,
        })
        return sendJson(res, 200, {
          ok: false,
          reason: 'cant_terminate',
          message: "Couldn't safely cancel — our team will handle this",
        })
      }
    } else {
      terminated = true // mock: the registry stands in for the supplier
    }
    order.terminatedAt = Date.now()
    await recordOrderEvent(orderId, 'refund_terminate_confirmed', { key, terminated })

    /* ═══ STEP 3 — STRIPE REFUND (only after confirmed termination) ═══════ */
    let stripeRefundId = `re_mock_${Math.random().toString(36).slice(2, 12)}`
    if (!isMockMode()) {
      if (!process.env.STRIPE_SECRET_KEY || !order.paymentIntentId) {
        await alertAdmin({
          alertType: 'refund_dead_esim_stripe_missing',
          orderId,
          detail: 'eSIM terminated but STRIPE_SECRET_KEY/paymentIntentId missing — user paid for a dead eSIM. Refund manually within 24h.',
        })
        order.refundInProgress = false
        order.refundNeedsAttention = true
        if (fsRef) await (fsRef.ref as { update: (d: unknown) => Promise<unknown> }).update({ refundInProgress: false, refundNeedsAttention: true, terminatedAt: order.terminatedAt })
        else await putOrder(order)
        return sendJson(res, 200, { ok: false, reason: 'stripe_unavailable', message: 'Our team will finalize your refund' })
      }
      const { default: Stripe } = await import('stripe')
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)
      let lastErr: unknown = null
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const re = await stripe.refunds.create({ payment_intent: order.paymentIntentId })
          stripeRefundId = re.id
          lastErr = null
          break
        } catch (err) {
          lastErr = err
          if (attempt < 3) await new Promise((r) => setTimeout(r, 500 * attempt))
        }
      }
      if (lastErr) {
        // Stripe failed 3× — user paid for a dead eSIM; human resolves
        order.refundInProgress = false
        order.refundNeedsAttention = true
        if (fsRef) await (fsRef.ref as { update: (d: unknown) => Promise<unknown> }).update({ refundInProgress: false, refundNeedsAttention: true, terminatedAt: order.terminatedAt })
        else await putOrder(order)
        await recordOrderEvent(orderId, 'refund_stripe_failed', { error: String(lastErr) })
        await alertAdmin({
          alertType: 'refund_stripe_failed_after_termination',
          orderId,
          detail: `eSIM terminated at supplier but Stripe refund failed 3×: ${String(lastErr)}. User paid for a dead eSIM — resolve within 24h.`,
        })
        return sendJson(res, 200, { ok: false, reason: 'stripe_failed', message: 'Our team will finalize your refund within 24h' })
      }
    }

    /* ── finalize: refunded_terminated + purge the install payload ─────── */
    const amountUSD = order.priceUSD ?? 0
    order.status = 'refunded_terminated'
    order.refundInProgress = false
    order.terminatedPayloadPurged = true
    order.refund = {
      executedAt: Date.now(),
      amountUSD,
      stripeRefundId,
      initiatedBy: 'user',
      gate: {
        checkedAt: now,
        reading: gateReading,
        windowEnd: order.guaranteeEndsAt ?? order.createdAt + GUARANTEE_WINDOW_MS,
      },
    }
    // anti-cheat: every copy of the code dies — server-side too
    order.qrUrl = ''
    order.lpaString = ''

    if (fsRef) {
      await (fsRef.ref as { update: (d: unknown) => Promise<unknown> }).update({
        status: 'refunded_terminated',
        refundInProgress: false,
        terminatedAt: order.terminatedAt,
        terminatedPayloadPurged: true,
        refund: order.refund,
        qrUrl: '',
        lpaString: '',
      })
    } else {
      await putOrder(order)
    }
    await recordOrderEvent(orderId, 'refund_executed', { amountUSD, stripeRefundId })
    console.log(JSON.stringify({ type: 'refund_executed', orderId, amountUSD, stripeRefundId }))

    return sendJson(res, 200, {
      ok: true,
      status: 'refunded_terminated',
      amountUSD,
      refundedAt: order.refund.executedAt,
    })
  } catch (err) {
    // unexpected — release the lock, alert, never leave a stuck order
    try {
      order.refundInProgress = false
      if (fsRef) await (fsRef.ref as { update: (d: unknown) => Promise<unknown> }).update({ refundInProgress: false })
      else await putOrder(order)
    } catch { /* best effort */ }
    await alertAdmin({ alertType: 'refund_execute_error', orderId, detail: String(err) })
    return sendJson(res, 500, { error: 'refund_failed', message: 'Refund failed — our team has been alerted' })
  }
})
