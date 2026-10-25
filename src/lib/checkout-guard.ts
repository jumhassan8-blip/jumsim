/**
 * Checkout abuse guards (Module 6) — client layer of the server rules.
 */
import { allow, retryAfterMs } from './ratelimit'
import { CONFIG } from '../config'

/** common disposable / throwaway email domains blocked at checkout */
const DISPOSABLE_DOMAINS = new Set([
  'tempmail.com',
  'temp-mail.org',
  '10minutemail.com',
  'guerrillamail.com',
  'mailinator.com',
  'yopmail.com',
  'throwawaymail.com',
  'fakeinbox.com',
  'getnada.com',
  'dispostable.com',
  'trashmail.com',
  'sharklasers.com',
  'getairmail.com',
  'mintemail.com',
  'mailnesia.com',
])

export function isDisposableEmail(email: string): boolean {
  const domain = email.split('@')[1]?.toLowerCase() ?? ''
  return DISPOSABLE_DOMAINS.has(domain)
}

/**
 * Gate an order attempt. Returns null when allowed, or an error message
 * to surface. Records the attempt when allowed.
 */
export function gateOrderAttempt(): string | null {
  const windowMs = 60_000
  if (!allow('order_attempt', CONFIG.orderRateLimitPerMinute, windowMs)) {
    const wait = Math.ceil(retryAfterMs('order_attempt', CONFIG.orderRateLimitPerMinute, windowMs) / 1000)
    return `Too many attempts — try again in ${wait}s`
  }
  return null
}

/**
 * Kill-the-app-mid-checkout safety: a pending order is written before the
 * provider call and cleared on success. On relaunch, Checkout notices it
 * and shows "Payment pending" instead of charging again — the server
 * reconciles via idempotency key + webhook, so no duplicate order or charge.
 */
const PENDING_KEY = 'jum-esim:pending-order:v1'

export interface PendingOrder {
  idempotencyKey: string
  planId: string
  email: string
  startedAt: number
}

export function setPendingOrder(p: PendingOrder): void {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify(p))
  } catch {
    /* non-fatal */
  }
}

export function readPendingOrder(): PendingOrder | null {
  try {
    const raw = localStorage.getItem(PENDING_KEY)
    if (!raw) return null
    const p = JSON.parse(raw) as PendingOrder
    // stale pending (>30 min) is dropped — the payment intent auto-expires server-side
    return Date.now() - p.startedAt > 30 * 60_000 ? null : p
  } catch {
    return null
  }
}

export function clearPendingOrder(): void {
  try {
    localStorage.removeItem(PENDING_KEY)
  } catch {
    /* non-fatal */
  }
}
