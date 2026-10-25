/**
 * Client lib for the Top Up tab — thin typed wrappers over /api/topup/*.
 * The server is authoritative for everything (operator detection, quotes,
 * fraud walls); this module only shapes calls and normalizes errors.
 */
import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js'

export interface TopUpProduct {
  id: string
  kind: 'airtime' | 'data'
  amountLocal: string
  amountUsd: number
  feeUsd: number
  validity: string | null
  deliverText: string
}

export interface TopUpQuote {
  quoteId: string
  productId: string
  msisdn: string
  amountUsd: number
  feeUsd: number
  totalUsd: number
  expiresAt: number
}

export interface DetectedOperator {
  id: string
  name: string
  detected: boolean
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

export interface TopUpOrder {
  id: string
  uid: string | null
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
  events: Array<{ t: number; event: string }>
}

export interface TopUpState {
  providerConfigured: string | null
  balanceUsd: number
  savedNumbers: SavedNumber[]
  recents: TopUpOrder[]
  pendingCount: number
  autoTopUps: Array<{
    id: string
    savedNumberId: string
    productId: string
    cadence: 'monthly' | 'weekly'
    dueDay: number
    enabled: boolean
    lastFiredAt: number | null
  }>
  uid: string | null
}

export class TopUpError extends Error {
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

async function call<T>(path: string, payload: Record<string, unknown>, idToken?: string | null): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (idToken) headers.Authorization = `Bearer ${idToken}`
  const res = await fetch(path, { method: 'POST', headers, body: JSON.stringify(payload) })
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) throw new TopUpError(res.status, body)
  return body as T
}

/** Bearer token for routes that accept Firebase auth — silent failure → guest. */
export async function topupAuthHeaders(): Promise<{ Authorization?: string }> {
  try {
    const { auth } = await import('../../config/firebase')
    const user = auth?.currentUser as { getIdToken?: () => Promise<string> } | null
    if (!user?.getIdToken) return {}
    const token = await user.getIdToken()
    return token ? { Authorization: `Bearer ${token}` } : {}
  } catch {
    return {}
  }
}

export async function fetchTopUpState(uid?: string | null): Promise<TopUpState> {
  return call<TopUpState>('/api/topup/state', uid ? { uid } : {})
}

export async function detectOperator(msisdn: string): Promise<{ operator: DetectedOperator | null }> {
  return call('/api/topup/operators/detect', { msisdn })
}

export async function fetchCatalog(countryIso: string, operatorId?: string): Promise<{ products: TopUpProduct[] }> {
  return call('/api/topup/catalog', { countryIso, operatorId })
}

export async function lockQuote(productId: string, msisdn: string): Promise<TopUpQuote> {
  return call<TopUpQuote>('/api/topup/quote', { productId, msisdn })
}

export interface ExecuteInput {
  quote: TopUpQuote
  countryIso: string
  operatorId: string
  operatorName: string
  kind: 'airtime' | 'data'
  payPath: 'balance' | 'card'
  clientSecret?: string
  cardFingerprint?: string
  firstCardUse?: boolean
  uid?: string | null
}

export async function executeTopUp(input: ExecuteInput): Promise<{ ok: boolean; order: TopUpOrder; delivered?: boolean; replayed?: boolean }> {
  return call('/api/topup/execute', { ...input })
}

export async function fetchTopUpStatus(orderId: string): Promise<{ order: TopUpOrder }> {
  return call('/api/topup/status', { orderId })
}

export async function saveNumber(input: {
  msisdn: string
  countryIso: string
  operatorName?: string | null
  nickname?: string
  lastProductId?: string | null
  uid?: string | null
}): Promise<{ ok: boolean; savedNumber: SavedNumber }> {
  return call('/api/topup/saved-numbers', { action: 'save', ...input })
}

export async function fetchSavedNumbers(uid?: string | null): Promise<{ savedNumbers: SavedNumber[] }> {
  return call('/api/topup/saved-numbers', { action: 'list', uid })
}

export async function joinWaitlist(countryIso: string, msisdn: string, uid?: string | null): Promise<{ ok: boolean }> {
  return call('/api/topup/waitlist', { countryIso, msisdn, uid })
}

/* ------------------------------------------------------------------ */
/* Number intelligence (brief §3)                                     */
/* ------------------------------------------------------------------ */

export interface ParsedNumber {
  msisdn: string
  countryIso: string
  valid: boolean
  isMobile: boolean
  nationalFormat: string
}

/** libphonenumber-js parse → normalized result. Never throws. */
export function parseNumber(input: string, defaultCountry?: CountryCode): ParsedNumber | null {
  try {
    const parsed = parsePhoneNumberFromString(input, defaultCountry)
    if (!parsed) return null
    return {
      msisdn: parsed.number.replace(/[^\d+]/g, ''),
      countryIso: parsed.country ?? '',
      valid: parsed.isValid(),
      isMobile: parsed.getType() === 'MOBILE' || parsed.getType() === 'FIXED_LINE_OR_MOBILE',
      nationalFormat: parsed.formatNational(),
    }
  } catch {
    return null
  }
}

/** Live formatting for the input field — returns formatted or raw digits. */
export function formatAsYouType(input: string, defaultCountry?: CountryCode): string {
  try {
    const parsed = parsePhoneNumberFromString(input, defaultCountry)
    return parsed ? parsed.formatNational() : input.replace(/[^\d\s+-]/g, '')
  } catch {
    return input
  }
}

/** Reward-maturity guardrail note (brief §4): airtime margins are thin —
 *  the rewards engine gives 0–2% here; full rewards stay on eSIM products. */
export const AIRTIME_REWARDS_PCT = 2
