/**
 * Calls-tab client: server-authoritative balance bus, /api/calls/* wrappers,
 * and localStorage call history.
 *
 * BALANCE RULE: the app never decrements credit locally. It renders whatever
 * the server last reported (getCallBalance / start / end responses) and
 * refreshes after every mutation. A tiny module-level bus shares the number
 * between the TabBar badge dot and the Calls screen chip.
 */
import { CONFIG } from '../config'
import type { CallHistoryEntry, CallRate } from '../types'
import callRatesJson from '../data/call-rates.json'

const RATES = callRatesJson as CallRate[]
const rateByIso = new Map(RATES.map((r) => [r.iso2, r]))

const BALANCE_EVENT = 'jum:call-balance-changed'

interface BalanceState {
  balanceUSD: number | null
  /** seconds of credit at the currently-selected destination rate */
  secondsAtRate: number | null
}

let balance: BalanceState = { balanceUSD: null, secondsAtRate: null }

export function getCachedBalance(): BalanceState {
  return balance
}

export function publishBalance(next: BalanceState): void {
  balance = next
  try {
    window.dispatchEvent(new CustomEvent(BALANCE_EVENT, { detail: next }))
  } catch {
    /* non-DOM test env */
  }
}

export function subscribeBalance(fn: (s: BalanceState) => void): () => void {
  const handler = (e: Event) => fn((e as CustomEvent<BalanceState>).detail)
  try {
    window.addEventListener(BALANCE_EVENT, handler)
    return () => window.removeEventListener(BALANCE_EVENT, handler)
  } catch {
    return () => {}
  }
}

// ── stored destination (drives the tab-bar badge dot app-wide) ───────

export const CALL_DEST_KEY = 'jum-esim:call-dest:v1'

export function loadStoredDestination(): CallRate {
  let iso = 'US'
  try {
    iso = localStorage.getItem(CALL_DEST_KEY) ?? 'US'
  } catch {
    /* non-DOM */
  }
  return rateByIso.get(iso) ?? rateByIso.get('US') ?? RATES[0]
}

/**
 * App-wide balance refresh — call once at shell mount (TabBar) so the badge
 * dot is right on every screen, not just inside the Calls tab. Uses the
 * stored destination's rate for the seconds conversion.
 */
export async function refreshCallBalance(): Promise<void> {
  try {
    const [b, dest] = await Promise.all([fetchCallBalance(), Promise.resolve(loadStoredDestination())])
    publishBalance({
      balanceUSD: b.balanceUSD,
      secondsAtRate:
        dest.mobilePerMin > 0 ? Math.floor((b.balanceUSD / dest.mobilePerMin) * 60) : null,
    })
  } catch {
    /* offline — keep last known balance */
  }
}

async function post<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${CONFIG.apiUrl}/api/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) {
    const err = new Error((data as { error?: string }).error ?? `http_${res.status}`) as Error & {
      status?: number
      data?: unknown
    }
    err.status = res.status
    err.data = data
    throw err
  }
  return data
}

export interface CallBalance {
  balanceUSD: number
}

export function fetchCallBalance(): Promise<CallBalance> {
  return post<CallBalance>('calls/balance', {})
}

export interface StartCallResult {
  sid: string
  token: string | null
  to: string
  iso2: string
  ratePerMin: number
  balanceUSD: number
  balanceSeconds: number
}

export function startCall(to: string, iso2: string): Promise<StartCallResult> {
  return post<StartCallResult>('calls/start', { to, iso2 })
}

export interface EndCallResult {
  durationSec: number
  costUSD: number
  balanceUSD: number
}

export function endCall(sid: string, durationSec: number): Promise<EndCallResult> {
  return post<EndCallResult>('calls/end', { sid, durationSec })
}

export interface CreditResult {
  balanceUSD: number
  packUSD: number
}

/** True once the account has bought call credit on this device. */
export function hasBoughtCallCredit(): boolean {
  try {
    return localStorage.getItem('jum-esim:call-credit-bought:v1') === '1'
  } catch {
    return false
  }
}

export function markBoughtCallCredit(): void {
  try {
    localStorage.setItem('jum-esim:call-credit-bought:v1', '1')
  } catch {
    /* non-fatal */
  }
}

// ── call history (device-local, like the analytics log) ──────────────

const HISTORY_KEY = 'jum-esim:call-history:v1'
const MAX_HISTORY = 50

export function loadCallHistory(): CallHistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    return raw ? (JSON.parse(raw) as CallHistoryEntry[]) : []
  } catch {
    return []
  }
}

function save(entries: CallHistoryEntry[]): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(entries.slice(0, MAX_HISTORY)))
  } catch {
    /* non-fatal */
  }
}

export function addCallHistory(entry: CallHistoryEntry): void {
  save([entry, ...loadCallHistory()])
}

export function deleteCallHistory(id: string): void {
  save(loadCallHistory().filter((e) => e.id !== id))
}

/** mm:ss — used by the balance chip, countdowns and the end summary */
export function formatMinSec(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
