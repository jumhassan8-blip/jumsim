/**
 * Mock order store.
 *
 * MOCK MODE keeps orders in an in-memory Map — fine for a demo where a
 * single function instance serves the traffic. For real traffic (or
 * multi-instance serverless) set KV_REST_API_URL + KV_REST_API_TOKEN
 * (Upstash Redis REST — zero-dependency, fetch-based) and the store
 * transparently persists there.
 */

export interface StoredOrder {
  orderId: string
  iccid: string
  /** PRIMARY provider key — eSIM Access esimTranNo (iccid is secondary);
   *  eSIM Go reuses the iccid. See api/providers/types.ts. */
  esimTranNo?: string
  provider?: 'esimaccess' | 'esimg'
  providerOrderNo?: string
  /** anonymous-auth device uid stamped at checkout — enables the email-match
   *  re-association path in /api/auth/reassociate (Admin SDK) */
  uid?: string
  qrUrl: string
  lpaString: string
  smdpAddress: string
  matchingId: string
  expiresAt: number
  planId: string
  email: string
  createdAt: number
  topUpFor?: string
  /** 'refunded_terminated' = ANTI-CHEAT refund: supplier killed FIRST, then
   *  Stripe refund. Set ONLY by POST /api/refund/execute after confirmed
   *  termination. */
  status: 'active' | 'refunded' | 'refunded_terminated'
  /** idempotency replay protection */
  idempotencyKey?: string

  // ── user-requested refund (POST /api/refund/execute) ──────────────────
  /** server-side price snapshot (Stripe refund amount) */
  priceUSD?: number
  /** Stripe payment intent id (pi_…) — refund target */
  paymentIntentId?: string
  /** T+10 minutes; the user-requested refund window end. Display only —
   *  the server re-checks everything at execute time. */
  guaranteeEndsAt?: number
  /** double-tap race guard — while set, requests answer 'Refund in progress' */
  refundInProgress?: boolean
  /** supplier termination confirmed at this time (step 2 of the sequence) */
  terminatedAt?: number
  /** install payload purged after termination (anti-cheat: dead QR everywhere) */
  terminatedPayloadPurged?: boolean
  refund?: {
    executedAt: number
    amountUSD: number
    stripeRefundId: string
    initiatedBy: 'user'
    /** exact verify-unused gate snapshot that allowed it — auditable */
    gate: Record<string, unknown>
  }
  /** Stripe refund failed 3× after confirmed termination — human resolves */
  refundNeedsAttention?: boolean
  /** server-recorded analytics for this order */
  events?: { at: number; event: string; data?: Record<string, unknown> }[]
}

const memory = new Map<string, StoredOrder>()
const byIdempotency = new Map<string, string>() // key -> orderId

const kvEnabled = () => Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN)

async function kv<T>(command: string, args: string[]): Promise<T | null> {
  const res = await fetch(`${process.env.KV_REST_API_URL}/${command}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  })
  if (!res.ok) return null
  const data = (await res.json()) as { result: T | null }
  return data.result
}

export async function findByIdempotency(key: string): Promise<StoredOrder | null> {
  if (!key) return null
  if (kvEnabled()) {
    const orderId = await kv<string>('get', [`idem:${key}`])
    return orderId ? getOrder(orderId) : null
  }
  const orderId = byIdempotency.get(key)
  return orderId ? getOrder(orderId) : null
}

export async function listOrders(): Promise<StoredOrder[]> {
  if (kvEnabled()) {
    const keys = (await kv<string[]>('keys', ['order:*'])) ?? []
    const out: StoredOrder[] = []
    for (const k of keys) {
      const raw = await kv<string>('get', [k])
      if (raw) out.push(JSON.parse(raw) as StoredOrder)
    }
    return out
  }
  return [...memory.values()]
}

export async function getOrder(orderId: string): Promise<StoredOrder | null> {
  if (kvEnabled()) {
    const raw = await kv<string>('get', [`order:${orderId}`])
    return raw ? (JSON.parse(raw) as StoredOrder) : null
  }
  return memory.get(orderId) ?? null
}

export async function putOrder(order: StoredOrder): Promise<void> {
  if (kvEnabled()) {
    await kv('set', [`order:${order.orderId}`, JSON.stringify(order)])
    if (order.idempotencyKey) await kv('set', [`idem:${order.idempotencyKey}`, order.orderId])
    return
  }
  memory.set(order.orderId, order)
  if (order.idempotencyKey) byIdempotency.set(order.idempotencyKey, order.orderId)
}

export async function markRefunded(orderId: string): Promise<StoredOrder | null> {
  const order = await getOrder(orderId)
  if (!order) return null
  order.status = 'refunded_terminated'
  if (kvEnabled()) {
    await kv('set', [`order:${orderId}`, JSON.stringify(order)])
  } else {
    memory.set(orderId, order)
  }
  return order
}

/** ── Firestore lookup: web checkout orders live in users/{uid}/orders and
 *  guestOrders/{email}/orders — NOT in the KV/memory order store. Resolve
 *  an orderId → {ref, data} by scanning the checkout ledger, which carries
 *  uid + email + providerOrderNo for exactly this. */
export interface FirestoreOrderRef {
  ref: unknown // DocumentReference (typed loosely: no hard admin-sdk dep)
  path: string
  data: Record<string, unknown>
}

export async function resolveFirestoreOrder(
  orderId: string,
): Promise<FirestoreOrderRef | null> {
  const { adminDb } = await import('./firebase-admin')
  const db = await adminDb()
  if (!db) return null
  const ledger = await db
    .collection('checkoutIntents')
    .where('orderId', '==', orderId)
    .limit(1)
    .get()
    .catch(() => null)
  const ledgerDoc = ledger?.docs[0]
  const meta = ledgerDoc?.data() ?? {}
  const uid = meta.uid ? String(meta.uid) : null
  const email = meta.email ? String(meta.email) : null

  const candidates: string[] = []
  if (uid) candidates.push(`users/${uid}/orders/${orderId}`)
  if (email) {
    const key = email.toLowerCase().replace(/[^a-z0-9]/g, '_')
    candidates.push(`guestOrders/${key}/orders/${orderId}`)
  }
  for (const path of candidates) {
    const doc = await db.doc(path).get().catch(() => null)
    if (doc?.exists) return { ref: doc.ref, path, data: doc.data() as Record<string, unknown> }
  }
  return null
}

export function isMockMode(): boolean {
  return process.env.MOCK_MODE !== 'false'
}

/** Server-side analytics recorder — the engine can't reach the client's
 *  localStorage log, so events are persisted on the order and mirrored to
 *  stdout for the observability pipeline. The client fires the same events
 *  into its own log when it observes the transition via /api/orders/status. */
export async function recordEvent(
  order: StoredOrder,
  event: string,
  data?: Record<string, unknown>,
): Promise<void> {
  order.events = [...(order.events ?? []), { at: Date.now(), event, data }]
  await putOrder(order)
  console.log(JSON.stringify({ type: 'analytics', orderId: order.orderId, event, data }))
}
