/**
 * Gift card ledger + the security-critical code system (brief §4).
 *
 * Codes: XXXX-XXXX-XXXX-XXXX from CSPRNG, stored SHA-256 hashed ONLY.
 * Plaintext exists solely in the delivery message (and the purchase
 * response, so the sender can copy it) — never in the DB, never in logs,
 * never in analytics (grep-verified in acceptance).
 *
 * Redemption: single-use, transaction-locked via an atomic claimed flag
 * (no double-redeem race), redeemedAt + redeemedByUid stamped.
 * Guess-defense: 5 attempts/IP/hour → lockout + alert.
 * Purchase caps: $200/day per uid. Unredeemed-after-30d refundable to
 * sender via support ONLY (admin action, audit-logged; NO auto-refund).
 */
import crypto from 'node:crypto'

export type GiftType = 'jum_credit' | 'esim_balance' | 'football_pro'
export type GiftStatus =
  | 'pending_payment'
  | 'paid'
  | 'sent'
  | 'redeemed'
  | 'refunded'
  | 'voided'

export interface GiftRecipient {
  name: string
  email: string | null
  whatsapp: string | null
}

export interface GiftCard {
  id: string
  type: GiftType
  /** USD for credit/balance; months for football_pro */
  amount: number
  unit: 'usd' | 'months'
  senderUid: string | null
  senderEmail: string | null
  recipient: GiftRecipient
  message: string
  delivery: 'now' | 'scheduled'
  scheduledAt: number | null
  status: GiftStatus
  codeHash: string
  paymentIntentId: string | null
  /** base64url one-time delivery token (not the code itself) */
  deliveryToken: string
  createdAt: number
  paidAt: number | null
  sentAt: number | null
  redeemedAt: number | null
  redeemedByUid: string | null
  refundedAt: number | null
  events: Array<{ t: number; event: string }>
}

export interface GiftRedemption {
  codeHash: string
  giftId: string
  redeemedAt: number
  redeemedByUid: string
  appliedTo: string
}

/* ------------------------------------------------------------------ */
/* CSPRNG + hashing                                                   */
/* ------------------------------------------------------------------ */

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no I/O/0/1 ambiguity

/** XXXX-XXXX-XXXX-XXXX from crypto.randomFillSync. */
export function generateGiftCode(): string {
  const bytes = crypto.randomBytes(16)
  const chars = [...bytes].map((b) => ALPHABET[b % ALPHABET.length])
  const groups = [0, 4, 8, 12].map((i) => chars.slice(i, i + 4).join(''))
  return groups.join('-')
}

export function hashGiftCode(code: string): string {
  // Same normalization as normalizeCodeInput (strip ALL non-alphanumerics)
  // so hashing the formatted or unformatted code always converges.
  return crypto.createHash('sha256').update(code.toUpperCase().replace(/[^A-Z0-9]/g, '')).digest('hex')
}

export function normalizeCodeInput(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

export function isCodeFormat(raw: string): boolean {
  return /^[A-Z0-9]{4}-?[A-Z0-9]{4}-?[A-Z0-9]{4}-?[A-Z0-9]{4}$/i.test(raw.trim())
}

/* ------------------------------------------------------------------ */
/* in-memory reference store (Firestore bridge mirrors orders.ts)      */
/* ------------------------------------------------------------------ */

const gifts = new Map<string, GiftCard>()
const redemptionsByHash = new Map<string, GiftRedemption>()
/** guess-defense: ip → hour window attempts */
const guessAttempts = new Map<string, { hour: string; count: number; lockedUntil: number }>()
/** purchase caps: uid → day window spend */
const purchaseSpend = new Map<string, { day: string; total: number }>()

const dayKey = (): string => new Date().toISOString().slice(0, 10)
const hourKey = (): string => new Date().toISOString().slice(0, 13)

export async function getGift(id: string): Promise<GiftCard | null> {
  return gifts.get(id) ?? null
}

export async function getGiftByCodeHash(hash: string): Promise<GiftCard | null> {
  return [...gifts.values()].find((g) => g.codeHash === hash) ?? null
}

export async function getGiftByDeliveryToken(token: string): Promise<GiftCard | null> {
  return [...gifts.values()].find((g) => g.deliveryToken === token) ?? null
}

export async function putGift(g: GiftCard): Promise<void> {
  gifts.set(g.id, g)
}

export async function listAllGifts(): Promise<GiftCard[]> {
  return [...gifts.values()]
}

export async function listGiftsForSender(uid: string, limit = 50): Promise<GiftCard[]> {
  return [...gifts.values()]
    .filter((g) => g.senderUid === uid)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit)
}

export async function listScheduledDue(now: number, limit = 20): Promise<GiftCard[]> {
  return [...gifts.values()]
    .filter((g) => g.status === 'paid' && g.delivery === 'scheduled' && g.scheduledAt !== null && g.scheduledAt <= now)
    .sort((a, b) => (a.scheduledAt ?? 0) - (b.scheduledAt ?? 0))
    .slice(0, limit)
}

/* ------------------------------------------------------------------ */
/* redemption (transaction-locked)                                    */
/* ------------------------------------------------------------------ */

/**
 * Atomically claim a code. Returns the gift on first success; null when
 * the code is unknown or already claimed (double-redeem impossible —
 * the check-and-set has no macrotask yield between them).
 */
export function claimCode(hash: string, redeemerUid: string): { gift: GiftCard; redemption: GiftRedemption } | null {
  const existing = redemptionsByHash.get(hash)
  if (existing) return null // already redeemed — single use enforced
  const gift = [...gifts.values()].find((g) => g.codeHash === hash)
  if (!gift) return null
  if (gift.status !== 'sent' && gift.status !== 'paid') return null
  const redemption: GiftRedemption = {
    codeHash: hash,
    giftId: gift.id,
    redeemedAt: Date.now(),
    redeemedByUid: redeemerUid,
    appliedTo: '', // filled by the caller per app surface
  }
  redemptionsByHash.set(hash, redemption)
  gift.status = 'redeemed'
  gift.redeemedAt = redemption.redeemedAt
  gift.redeemedByUid = redeemerUid
  gift.events.push({ t: Date.now(), event: 'redeemed' })
  return { gift, redemption }
}

export function getRedemption(hash: string): GiftRedemption | null {
  return redemptionsByHash.get(hash) ?? null
}

/* ------------------------------------------------------------------ */
/* guess defense + purchase caps                                      */
/* ------------------------------------------------------------------ */

/** Returns remaining attempts this hour; 0 → locked. */
export function noteGuessAttempt(ip: string, maxPerHour = 5): number {
  const now = Date.now()
  const e = guessAttempts.get(ip)
  if (e && e.lockedUntil > now) return 0
  if (!e || e.hour !== hourKey()) {
    guessAttempts.set(ip, { hour: hourKey(), count: 1, lockedUntil: 0 })
    return maxPerHour - 1
  }
  e.count += 1
  if (e.count >= maxPerHour) {
    e.lockedUntil = now + 60 * 60 * 1000
    auditGift({ event: 'guess_lockout', ip, count: e.count })
  }
  guessAttempts.set(ip, e)
  return Math.max(0, maxPerHour - e.count)
}

export function guessLockoutRemaining(ip: string): number {
  const e = guessAttempts.get(ip)
  if (!e || e.lockedUntil <= Date.now()) return 0
  return Math.ceil((e.lockedUntil - Date.now()) / 1000)
}

export function purchasesToday(uid: string): number {
  const e = purchaseSpend.get(uid)
  return e && e.day === dayKey() ? e.total : 0
}

export function bumpPurchasesToday(uid: string, amountUsd: number): void {
  const e = purchaseSpend.get(uid)
  if (e && e.day === dayKey()) e.total += amountUsd
  else purchaseSpend.set(uid, { day: dayKey(), total: amountUsd })
}

/* ------------------------------------------------------------------ */
/* audit                                                              */
/* ------------------------------------------------------------------ */

export function auditGift(entry: Record<string, unknown>): void {
  // NEVER log the code or its hash in plaintext-context events beyond the
  // hash id itself (hash-only, safe). Plaintext codes must never appear.
  console.log(JSON.stringify({ t: new Date().toISOString(), ...entry }))
}
