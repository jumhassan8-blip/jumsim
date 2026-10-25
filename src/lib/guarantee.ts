/**
 * Refund window — client view of the server's state. NO AUTO-REFUND exists;
 * refunds happen only when the user taps "Request refund" and confirms,
 * which runs POST /api/refund/execute (verify unused → terminate at
 * supplier → Stripe refund, in that order, aborting on any failure).
 *
 * The app NEVER decides refundability itself: /api/orders/status is the
 * authority for the countdown + terminal state, and the execute endpoint
 * re-verifies everything live before any money moves.
 */
import { useEffect, useRef, useState } from 'react'
import { track } from './analytics'
import { CONFIG } from '../config'

export interface OrderGuarantee {
  orderId: string
  status: string
  guaranteeEndsAt: number
  windowOpen: boolean
  /** double-tap race guard — refund currently running server-side */
  refundInProgress: boolean
  /** terminated at supplier but the Stripe leg needs a human */
  refundNeedsAttention: boolean
  refundedAt: number | null
  terminatedAt: number | null
  events: { at: number; event: string; data?: Record<string, unknown> }[]
}

export type GuaranteeMap = Record<string, OrderGuarantee>

export async function fetchGuaranteeStatus(orderIds: string[]): Promise<GuaranteeMap> {
  if (orderIds.length === 0) return {}
  try {
    const res = await fetch(`${CONFIG.apiUrl}/api/orders/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderIds: orderIds.slice(0, 50) }),
    })
    if (!res.ok) return {}
    const json = (await res.json()) as { orders?: GuaranteeMap }
    return json.orders ?? {}
  } catch {
    return {} // offline — buttons hide, never block the flow
  }
}

function fireTransitionEvents(prev: GuaranteeMap | null, next: GuaranteeMap): void {
  for (const g of Object.values(next)) {
    const p = prev?.[g.orderId]
    if (!p) {
      if (g.refundedAt) track('refund_executed', { orderId: g.orderId })
      continue
    }
    if (!p.refundedAt && g.refundedAt) track('refund_executed', { orderId: g.orderId })
    if (!p.refundNeedsAttention && g.refundNeedsAttention) {
      track('refund_pending_manual', { orderId: g.orderId })
    }
  }
}

/**
 * Poll the server refund state for the given order ids. `onRefunded` lets
 * the store flip the local purchase to refunded on the terminal state.
 * Polls immediately, then every 30 s.
 */
export function useGuarantee(
  orderIds: string[],
  onRefunded?: (orderId: string) => void,
  /** bump to force an immediate re-poll (right after a refund request) */
  refreshKey = 0,
): GuaranteeMap {
  const [map, setMap] = useState<GuaranteeMap>({})
  const prevRef = useRef<GuaranteeMap | null>(null)
  const cbRef = useRef(onRefunded)
  cbRef.current = onRefunded
  const key = orderIds.slice().sort().join(',')

  useEffect(() => {
    let alive = true
    const ids = key ? key.split(',') : []
    if (ids.length === 0) {
      setMap({})
      return
    }
    const load = async () => {
      const next = await fetchGuaranteeStatus(ids)
      if (!alive) return
      fireTransitionEvents(prevRef.current, next)
      for (const g of Object.values(next)) {
        if (g.status === 'refunded_terminated' && g.refundedAt) cbRef.current?.(g.orderId)
      }
      prevRef.current = next
      setMap(next)
    }
    void load()
    const t = window.setInterval(load, 30_000)
    return () => {
      alive = false
      window.clearInterval(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, refreshKey])

  return map
}

/** Anti-cheat refund — POST /api/refund/execute. The server terminates the
 *  eSIM at the supplier BEFORE any money moves. */
export interface RefundExecuteResult {
  ok: boolean
  status?: string
  amountUSD?: number
  refundedAt?: number
  idempotent?: boolean
  reason?: 'in_use' | 'window_expired' | 'cant_terminate' | 'stripe_failed' | 'stripe_unavailable' | 'refund_in_progress' | 'refund_pending_manual' | 'unknown'
  message?: string
}

export async function executeRefund(orderId: string): Promise<RefundExecuteResult> {
  try {
    const res = await fetch(`${CONFIG.apiUrl}/api/refund/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId }),
    })
    const json = (await res.json()) as RefundExecuteResult & { error?: string }
    if (res.status === 409 && json.error === 'refund_in_progress') {
      return { ok: false, reason: 'refund_in_progress', message: 'Refund in progress' }
    }
    if (json.error && !json.reason) return { ok: false, reason: 'unknown', message: json.error }
    return json
  } catch {
    return { ok: false, reason: 'unknown', message: 'Network hiccup — try again' }
  }
}

/** "Guarantee valid for 06:12" — mm:ss countdown from the server anchor. */
export function formatWindowCountdown(guaranteeEndsAt: number, now: number): string {
  const s = Math.max(0, Math.ceil((guaranteeEndsAt - now) / 1000))
  const mm = String(Math.floor(s / 60)).padStart(2, '0')
  const ss = String(s % 60).padStart(2, '0')
  return `${mm}:${ss}`
}
