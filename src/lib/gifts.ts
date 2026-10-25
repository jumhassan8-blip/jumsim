/**
 * Client lib for Jum Gift Cards — typed wrappers over /api/gift/*.
 * The server is authoritative for prices, caps, code hashing and
 * redemption; this module only shapes calls and normalizes errors.
 */
export type GiftType = 'jum_credit' | 'esim_balance' | 'football_pro'

export interface GiftCreateResult {
  giftId: string
  clientSecret: string
  paymentIntentId: string
  publishableKey: string
  plaintextCode: string
  deliveryToken: string
  priceUsd: number
  scheduledAt: string | null
  mock?: boolean
}

export interface GiftPreview {
  type: GiftType
  amount: number
  unit: 'usd' | 'months'
  recipientName: string
  message: string
  valueUsd: number
  conversion: string
}

export interface GiftRedeemResult {
  ok: boolean
  giftId: string
  type: GiftType
  amount: number
  unit: 'usd' | 'months'
  appliedTo: string
  appliedValue: string
  redeemedAt: number
}

export interface MyGift {
  id: string
  type: GiftType
  amount: number
  unit: 'usd' | 'months'
  status: 'pending_payment' | 'paid' | 'sent' | 'redeemed' | 'refunded' | 'voided'
  recipientName: string
  recipientEmail: string | null
  recipientWhatsapp: string | null
  message: string
  delivery: 'now' | 'scheduled'
  scheduledAt: number | null
  createdAt: number
  sentAt: number | null
  redeemedAt: number | null
  deliveryToken: string
  priceUsd: number
}

export class GiftError extends Error {
  code: string
  status: number
  extra: Record<string, unknown>
  constructor(status: number, body: Record<string, unknown>) {
    super(String(body.error ?? `http_${status}`))
    this.code = String(body.error ?? 'unknown')
    this.status = status
    this.extra = body
  }
}

async function call<T>(path: string, payload: Record<string, unknown>): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  try {
    const { auth } = await import('../../config/firebase')
    const user = auth?.currentUser as { getIdToken?: () => Promise<string> } | null
    const token = user?.getIdToken ? await user.getIdToken() : null
    if (token) headers.Authorization = `Bearer ${token}`
  } catch { /* guest */ }
  const res = await fetch(path, { method: 'POST', headers, body: JSON.stringify(payload) })
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) throw new GiftError(res.status, body)
  return body as T
}

/** Paste-friendly: strips separators, uppercases, re-groups 4×4. */
export function hyphenateCode(raw: string): string {
  const norm = raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16)
  return [0, 4, 8, 12].map((i) => norm.slice(i, i + 4)).filter(Boolean).join('-')
}

export function isCompleteCode(raw: string): boolean {
  return /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(raw.trim())
}

export function createGift(input: {
  type: GiftType
  amount: number
  recipientName: string
  recipientEmail?: string
  recipientWhatsapp?: string
  message: string
  delivery: 'now' | 'scheduled'
  scheduledAt?: number
  senderEmail?: string
}): Promise<GiftCreateResult> {
  return call<GiftCreateResult>('/api/gift/create', input)
}

/** Preview conversion BEFORE confirming a redeem. Does NOT count guesses. */
export function previewGift(code: string): Promise<GiftPreview> {
  return call<GiftPreview>('/api/gift/preview', { code })
}

export function redeemGift(code: string): Promise<GiftRedeemResult> {
  return call<GiftRedeemResult>('/api/gift/redeem', { code })
}

export function fetchMyGifts(): Promise<{ gifts: MyGift[] }> {
  return call<{ gifts: MyGift[] }>('/api/gift/mine', {})
}

/** Sender-only. Regenerates the delivery token (old link dies). */
export function resendGift(giftId: string): Promise<{ ok: boolean; deliveryToken: string }> {
  return call('/api/gift/resend', { giftId })
}

/** Server price table mirror for display (authoritative copy lives server-side). */
export const GIFT_PRODUCTS: Record<GiftType, { amounts: number[]; unit: 'usd' | 'months'; price: (a: number) => number }> = {
  jum_credit: { amounts: [5, 10, 25, 50], unit: 'usd', price: (a) => a },
  esim_balance: { amounts: [5, 10, 25, 50], unit: 'usd', price: (a) => a },
  football_pro: { amounts: [1, 3, 12], unit: 'months', price: (a) => ({ 1: 4.99, 3: 11.99, 12: 39.99 })[a] ?? 0 },
}

export function giftTypeLabel(t: (k: string) => string, type: GiftType): string {
  return t(`gifts.type.${type}`)
}
