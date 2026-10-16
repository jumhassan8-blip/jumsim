/**
 * Call-credit + call-session store (mock Twilio Voice backend).
 *
 * MOCK MODE keeps everything in memory — fine for the local demo where one
 * function instance serves all traffic. Production shape: the same handlers
 * mint a real Twilio Voice token (TWILIO_ACCOUNT_SID / TWILIO_API_KEY_SID /
 * TWILIO_API_KEY_SECRET server-side) and persist balance/sessions in the KV
 * store, exactly like api/lib/orders.ts.
 *
 * BALANCE IS SERVER-AUTHORITATIVE: the client never decrements credit. The
 * app renders balances the server reports; /calls/end bills by the second
 * at the rate snapshot taken at call start.
 */
import callRatesJson from '../../src/data/call-rates.json'

export interface CallRateEntry {
  iso2: string
  country: string
  dialCode: string
  mobilePerMin: number
  landlinePerMin: number
}

const RATES = callRatesJson as CallRateEntry[]
const rateByIso = new Map(RATES.map((r) => [r.iso2, r]))
/** longest dial codes first so "+1242" wins over "+1" during prefix matching */
const byDialPrefix = [...RATES].sort(
  (a, b) => b.dialCode.replace('+', '').length - a.dialCode.replace('+', '').length,
)

export function rateForIso(iso2: string): CallRateEntry | null {
  return rateByIso.get(iso2.toUpperCase()) ?? null
}

/** "+81 …" → Japan. Returns null when the dialed digits match no known code. */
export function matchByDialPrefix(dialed: string): CallRateEntry | null {
  const digits = dialed.replace(/^\+/, '').replace(/[^\d]/g, '')
  if (!digits) return null
  for (const r of byDialPrefix) {
    const code = r.dialCode.replace('+', '')
    if (digits.startsWith(code)) return r
  }
  return null
}

export const EMERGENCY_NUMBERS = ['112', '911', '999']

// ── account store ────────────────────────────────────────────────────

interface Account {
  balanceUSD: number
  /** payment-intent ids already credited (idempotency — never double-credit) */
  creditedIntents: Set<string>
}

const accounts = new Map<string, Account>()
const account = (id: string): Account => {
  let a = accounts.get(id)
  if (!a) {
    a = { balanceUSD: 0, creditedIntents: new Set() }
    accounts.set(id, a)
  }
  return a
}

export function getBalance(accountId: string): number {
  return account(accountId).balanceUSD
}

/** Adds a pack; idempotent per payment intent id. Returns the new balance. */
export function creditPack(accountId: string, packUSD: number, paymentIntentId: string): number {
  const a = account(accountId)
  if (!a.creditedIntents.has(paymentIntentId)) {
    a.creditedIntents.add(paymentIntentId)
    a.balanceUSD = Math.round((a.balanceUSD + packUSD) * 100) / 100
  }
  return a.balanceUSD
}

/** Removes a pack's credit (used when the payment later turns out declined). */
export function revokePack(accountId: string, packUSD: number, paymentIntentId: string): void {
  const a = account(accountId)
  if (a.creditedIntents.delete(paymentIntentId)) {
    a.balanceUSD = Math.max(0, Math.round((a.balanceUSD - packUSD) * 100) / 100)
  }
}

// ── call sessions ────────────────────────────────────────────────────

export interface CallSession {
  sid: string
  accountId: string
  to: string
  iso2: string
  /** USD/min snapshot at start — this is what gets billed */
  ratePerMin: number
  startedAt: number
  status: 'ringing' | 'active'
  billedSec: number
}

const sessions = new Map<string, CallSession>()

export function oneActiveSession(accountId: string): CallSession | null {
  for (const s of sessions.values()) if (s.accountId === accountId) return s
  return null
}

export function getSession(sid: string): CallSession | null {
  return sessions.get(sid) ?? null
}

/** Guardrail: one active call per account, balance checked BEFORE connect. */
export function createSession(
  accountId: string,
  to: string,
  iso2: string,
  minStartSeconds: number,
): { ok: true; session: CallSession } | { ok: false; error: string; balanceUSD: number; requiredUSD: number } {
  if (oneActiveSession(accountId)) return { ok: false, error: 'call_in_progress', balanceUSD: getBalance(accountId), requiredUSD: 0 }
  const rate = rateForIso(iso2)
  if (!rate) return { ok: false, error: 'unknown_destination', balanceUSD: getBalance(accountId), requiredUSD: 0 }
  const balanceUSD = getBalance(accountId)
  const requiredUSD = Math.round(rate.mobilePerMin * 100 * (minStartSeconds / 60)) / 100
  if (balanceUSD < requiredUSD) {
    return { ok: false, error: 'insufficient_credit', balanceUSD, requiredUSD }
  }
  const sid = `CA${Math.random().toString(36).slice(2, 10).toUpperCase()}`
  const session: CallSession = {
    sid,
    accountId,
    to,
    iso2: rate.iso2,
    ratePerMin: rate.mobilePerMin,
    startedAt: Date.now(),
    status: 'ringing',
    billedSec: 0,
  }
  sessions.set(sid, session)
  return { ok: true, session }
}

export interface EndResult {
  durationSec: number
  costUSD: number
  balanceUSD: number
}

/**
 * Bills an ended call by the second at the start-time rate snapshot.
 * Unanswered / busy (durationSec = 0) → no charge. Hard-clamps the charge
 * to the balance so a mid-call top-up race can never go negative.
 */
export function endSession(accountId: string, sid: string, durationSec: number): EndResult | null {
  const s = sessions.get(sid)
  if (!s || s.accountId !== accountId) return null
  sessions.delete(sid)
  const billedSec = Math.max(0, Math.floor(durationSec))
  const a = account(accountId)
  if (billedSec === 0) return { durationSec: 0, costUSD: 0, balanceUSD: a.balanceUSD }
  const raw = (billedSec * s.ratePerMin) / 60
  const costUSD = Math.min(a.balanceUSD, Math.round(raw * 100) / 100)
  a.balanceUSD = Math.round((a.balanceUSD - costUSD) * 100) / 100
  return { durationSec: billedSec, costUSD, balanceUSD: a.balanceUSD }
}

/** MOCK_MODE simulated answering: a ringing session goes active after ~3s. */
export function markAnswered(sid: string): void {
  const s = sessions.get(sid)
  if (s) s.status = 'active'
}
