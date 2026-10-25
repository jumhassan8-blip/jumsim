/**
 * Usage detection — the verify-unused gate's source of truth.
 *
 * "Used" = ANY network connection on the eSIM, even 1 KB / 1 second, checked
 * LIVE against the active provider (PROVIDER env) at the moment of the
 * refund gate. Never trust the app, never trust cached state.
 *
 * Feeds:
 *  - Live gate — POST /api/refund/execute calls verifyUnused() fresh for
 *    every refund attempt.
 *  - Webhooks — /api/webhooks/esimaccess (DATA_USAGE / ESIM_STATUS) and
 *    /api/webhooks/esimgo note usage into the mock registry (dev) or stamp
 *    lastProviderEventAt on matching orders (live).
 */
import { getOrder, isMockMode, listOrders, putOrder, type StoredOrder } from './orders'
import { recordOrderEvent } from './guarantee'

/** mock-mode registry: esim key → bytes seen (dev harness + webhooks) */
const mockUsageKB = new Map<string, number>()

export function mockNoteUsage(key: string, usedKB: number): void {
  mockUsageKB.set(key, (mockUsageKB.get(key) ?? 0) + usedKB)
}

export interface UsageReading {
  used: boolean
  /** total bytes seen by the provider (0 when never connected) */
  totalBytes: number
  /** provider state for the eSIM, normalized lowercase */
  esimStatus: string
}

/** the provider key that identifies this eSIM for usage queries */
export function esimKeyFor(order: StoredOrder): string {
  // esimTranNo is PRIMARY everywhere (eSIM Access requires it; eSIM Go
  // tolerates it = the iccid it stored)
  return order.esimTranNo || order.iccid
}

export async function readUsage(key: string): Promise<UsageReading> {
  if (isMockMode()) {
    const kb = mockUsageKB.get(key) ?? 0
    return { used: kb > 0, totalBytes: kb * 1024, esimStatus: kb > 0 ? 'in_use' : 'got_resource' }
  }
  // ── LIVE ────────────────────────────────────────────────────────────
  const { getProvider } = await import('../providers')
  const provider = getProvider()
  const reading = await provider.usage(key)
  const used = reading.usedBytes > 0 || /in_use|activated|used_up/.test(reading.status)
  return { used, totalBytes: reading.usedBytes, esimStatus: reading.status || 'unknown' }
}

/**
 * STEP 1 gate of the anti-cheat refund sequence: a FRESH provider call
 * proving the eSIM was never installed/activated and consumed zero bytes.
 * Does NOT mutate the order — the caller decides what a denial means.
 */
export async function verifyUnused(order: StoredOrder): Promise<{ ok: boolean; reading: UsageReading }> {
  const reading = await readUsage(esimKeyFor(order))
  return { ok: !reading.used && reading.totalBytes === 0, reading }
}

/** webhook path — stamp the latest usage fact on matching orders (live),
 *  and feed the mock registry so a later gate agrees (dev). */
export async function applyUsageWebhook(
  key: string,
  eventType: string,
  usedKB: number,
): Promise<{ matched: boolean }> {
  if (usedKB > 0) mockNoteUsage(key, usedKB)
  const orders = await listOrders()
  const order =
    orders.find((o) => esimKeyFor(o) === key && !o.topUpFor) ??
    orders.find((o) => esimKeyFor(o) === key) ??
    orders.find((o) => o.iccid === key)
  if (!order) return { matched: false }
  const { adminDb } = await import('./firebase-admin')
  const db = await adminDb()
  if (db) {
    await db
      .collectionGroup('orders')
      .where('esimTranNo', '==', order.esimTranNo ?? order.iccid)
      .get()
      .then((snap: { docs: Array<{ ref: { set: (d: unknown, o?: unknown) => Promise<unknown> } }> }) =>
        Promise.all(
          snap.docs.map((d) =>
            d.ref.set(
              { lastProviderEventAt: Date.now(), lastUsedKB: usedKB, ...(usedKB > 0 ? { everUsed: true } : {}) },
              { merge: true },
            ),
          ),
        ),
      )
      .catch(() => {})
  }
  await recordOrderEvent(order.orderId, 'usage_webhook', { eventType, usedKB })
  return { matched: true }
}
