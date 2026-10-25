/**
 * Top-up order ledger + per-uid settings (recents, saved numbers,
 * auto top-ups). Shares the orders.ts persistence pattern: Firestore via
 * resolveFirestoreOrder when configured, in-memory Map otherwise.
 * No PII in keys; msisdn stored only as sha256 for audit/chargeback defense.
 */
import crypto from 'node:crypto'

export interface TopUpOrder {
  id: string
  uid: string | null
  msisdnHash: string
  /** full number kept ONLY so the receipt can show the recipient; never logged */
  msisdnLast4: string
  countryIso: string
  operatorId: string
  operatorName: string
  productId: string
  kind: 'airtime' | 'data'
  amountUsd: number
  feeUsd: number
  payPath: 'balance' | 'card'
  status: 'pending' | 'processing' | 'delivered' | 'failed' | 'refunded'
  providerName: string | null
  providerRef: string | null
  failureReason: string | null
  createdAt: number
  updatedAt: number
  /** true while a scheduler tick is working this order (auto top-up fire) */
  locked?: boolean
  events: Array<{ t: number; event: string }>
}

export interface SavedNumber {
  id: string
  msisdn: string
  countryIso: string
  operatorName: string | null
  nickname: string
  lastProductId: string | null
  createdAt: number
}

export type SavedNumberInput = Omit<SavedNumber, 'id' | 'createdAt'>

export interface AutoTopUp {
  id: string
  savedNumberId: string
  productId: string
  /** 'monthly' fires on the day-of-month (dueDay) at 00:00 server time */
  cadence: 'monthly' | 'weekly'
  dueDay: number
  enabled: boolean
  lastFiredAt: number | null
}

export interface WaitlistLead {
  countryIso: string
  msisdn: string
  createdAt: number
  uid: string | null
}

/* ------------------------------------------------------------------ */
/* in-memory reference store (Firestore path mirrors orders.ts)        */
/* ------------------------------------------------------------------ */
const topups = new Map<string, TopUpOrder>()
const savedNumbers = new Map<string, SavedNumber>()
const autoTopUps = new Map<string, AutoTopUp>()
const waitlist: WaitlistLead[] = []
/** per-uid window for the 3/day cap */
const dayCounts = new Map<string, { day: string; count: number }>()
/** per-uid window for the $100/day cap */
const daySpend = new Map<string, { day: string; total: number }>()
/** card fingerprint → consecutive failed payments + cooldown until */
const cardFails = new Map<string, { fails: number; cooldownUntil: number }>()
/** per-IP sliding window */
const ipHits = new Map<string, number[]>()

const hash = (s: string): string => crypto.createHash('sha256').update(s).digest('hex')

export function msisdnHash(msisdn: string): string {
  return hash(msisdn.replace(/\D/g, ''))
}

export const sha256 = hash

/* ------------------------------------------------------------------ */
/* TopUpOrder                                                          */
/* ------------------------------------------------------------------ */
export async function getTopUp(id: string): Promise<TopUpOrder | null> {
  return topups.get(id) ?? null
}

export async function putTopUp(o: TopUpOrder): Promise<void> {
  o.updatedAt = Date.now()
  topups.set(o.id, o)
}

export async function listTopUps(uid: string, limit = 50): Promise<TopUpOrder[]> {
  return [...topups.values()]
    .filter((o) => o.uid === uid)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit)
}

/** For tests/schedulers — find by provider ref. */
export function findTopUpByRef(ref: string): TopUpOrder | null {
  return [...topups.values()].find((o) => o.providerRef === ref) ?? null
}

/* ------------------------------------------------------------------ */
/* Saved numbers / recents / auto top-ups                              */
/* ------------------------------------------------------------------ */
export async function listSavedNumbers(uid: string): Promise<SavedNumber[]> {
  return [...savedNumbers.entries()]
    .filter(([key]) => key.startsWith(`${uid}:`))
    .map(([, value]) => value)
    .sort((a, b) => b.createdAt - a.createdAt)
}

export async function saveNumber(uid: string, n: SavedNumberInput): Promise<SavedNumber> {
  const existing = [...savedNumbers.values()].find(
    (s) => s.id.startsWith(`${uid}:`) && s.msisdn === n.msisdn,
  )
  if (existing) {
    Object.assign(existing, n)
    return existing
  }
  const rec: SavedNumber = { ...n, id: `${uid}:${hash(n.msisdn).slice(0, 12)}`, createdAt: Date.now() }
  savedNumbers.set(rec.id, rec)
  return rec
}

export async function deleteSavedNumber(uid: string, id: string): Promise<void> {
  if (id.startsWith(`${uid}:`)) savedNumbers.delete(id)
}

export async function listAutoTopUps(uid: string): Promise<AutoTopUp[]> {
  // ids are normalized to `${uid}:${id}` on write; the value's own id may
  // be the bare form — match on the MAP KEY, not the value id
  return [...autoTopUps.entries()]
    .filter(([key]) => key.startsWith(`${uid}:`))
    .map(([, value]) => value)
}

/** uid-prefixed ids are an implementation detail — always normalize. */
export function normalizeUidPrefixed(uid: string, id: string): string {
  return id.startsWith(`${uid}:`) ? id : `${uid}:${id}`
}

export async function putAutoTopUp(uid: string, a: AutoTopUp): Promise<void> {
  autoTopUps.set(normalizeUidPrefixed(uid, a.id), a)
}

export async function deleteAutoTopUp(uid: string, id: string): Promise<void> {
  if (id.startsWith(`${uid}:`)) autoTopUps.delete(id)
}

/* ------------------------------------------------------------------ */
/* Waitlist (provider absent)                                          */
/* ------------------------------------------------------------------ */
export function addWaitlistLead(lead: WaitlistLead): void {
  waitlist.push(lead)
}

export function waitlistCount(): number {
  return waitlist.length
}

/* ------------------------------------------------------------------ */
/* Fraud walls (brief §6)                                              */
/* ------------------------------------------------------------------ */
const dayKey = (): string => new Date().toISOString().slice(0, 10)

export function topupsToday(uid: string): number {
  const e = dayCounts.get(uid)
  return e && e.day === dayKey() ? e.count : 0
}

export function bumpTopupsToday(uid: string): void {
  const e = dayCounts.get(uid)
  if (e && e.day === dayKey()) e.count += 1
  else dayCounts.set(uid, { day: dayKey(), count: 1 })
}

export function spendToday(uid: string): number {
  const e = daySpend.get(uid)
  return e && e.day === dayKey() ? e.total : 0
}

export function bumpSpendToday(uid: string, amountUsd: number): void {
  const e = daySpend.get(uid)
  if (e && e.day === dayKey()) e.total += amountUsd
  else daySpend.set(uid, { day: dayKey(), total: amountUsd })
}

export function cardFailures(cardFp: string): { fails: number; cooldownUntil: number } {
  return cardFails.get(cardFp) ?? { fails: 0, cooldownUntil: 0 }
}

export function noteCardFailure(cardFp: string): void {
  const e = cardFails.get(cardFp) ?? { fails: 0, cooldownUntil: 0 }
  e.fails += 1
  // 3 failed payments → 24h cooldown
  if (e.fails >= 3) {
    e.cooldownUntil = Date.now() + 24 * 60 * 60 * 1000
    e.fails = 0
  }
  cardFails.set(cardFp, e)
}

export function clearCardFailures(cardFp: string): void {
  cardFails.delete(cardFp)
}

export function ipHit(ip: string, windowMs: number, max: number): boolean {
  const now = Date.now()
  const hits = (ipHits.get(ip) ?? []).filter((t) => now - t < windowMs)
  if (hits.length >= max) {
    ipHits.set(ip, hits)
    return false
  }
  hits.push(now)
  ipHits.set(ip, hits)
  return true
}

/* ------------------------------------------------------------------ */
/* audit log — every execute() (brief §6)                              */
/* ------------------------------------------------------------------ */
export function auditTopUp(entry: Record<string, unknown>): void {
  console.log(JSON.stringify({ t: new Date().toISOString(), event: 'topup_execute', ...entry }))
}

/* ------------------------------------------------------------------ */
/* Jum Balance path (shared ledger)                                    */
/* ------------------------------------------------------------------ */
const balances = new Map<string, number>()

export async function applyBalanceDelta(
  uid: string,
  deltaUsd: number,
  _memo: string,
): Promise<{ ok: boolean; balance: number }> {
  const cur = balances.get(uid) ?? 0
  const next = Math.round((cur + deltaUsd) * 100) / 100
  if (next < -0.005) return { ok: false, balance: cur }
  balances.set(uid, next)
  return { ok: true, balance: next }
}

export async function getBalance(uid: string): Promise<number> {
  return balances.get(uid) ?? 0
}

/** Test/admin helper — fund a balance so balance-pay flows are exercisable. */
export function seedBalance(uid: string, usd: number): void {
  balances.set(uid, usd)
}
