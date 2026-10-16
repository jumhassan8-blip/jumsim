/**
 * Local currency display — the client half of the 190-currency module.
 *
 * Prices stay USD server-side (Stripe charges USD — card networks convert
 * for the user). The app NEVER fetches FX itself: rates come from our own
 * /api/fx endpoint (the server caches a daily USD→all table). A small
 * embedded table is the offline fallback so every screen still renders —
 * it is display-only and its source is always labeled.
 *
 * Display rules:
 *  - Intl.NumberFormat(locale, { currency }) — symbol position, separators
 *    and decimals follow the locale's conventions.
 *  - Currencies with cents round UP to the local "x.99" convention.
 *  - Zero-decimal currencies (JPY, KRW, VND…) round to a clean whole
 *    number — never "¥2,500.99".
 *  - Checkout additionally shows the original USD small ("≈ $16.99").
 */
import { useSyncExternalStore } from 'react'
import { CONFIG } from '../config'
import { track } from './analytics'
import {
  ALL_CURRENCIES,
  REGION_TO_CURRENCY,
  LANGUAGE_REGION,
  ZERO_DECIMAL,
} from './currency-data'
import { deviceRegion } from '../i18n'

export interface FxState {
  /** resolved display currency (ISO 4217) */
  currency: string
  /** USD → currency multiplier (1 = display USD) */
  rate: number
  /** where rates came from — surfaced in the checkout footnote */
  source: 'server' | 'embedded-fallback'
  fetchedAt: number
  /** the user's explicit choice, or 'auto' */
  override: string
}

const FX_KEY = 'jum-esim:fx-cache:v1'
const CUR_KEY = 'jum-esim:currency:v1'
const DAY = 24 * 60 * 60 * 1000

/** Embedded fallback (majors table) — used only when the server is
 *  unreachable; replaced by /api/fx on the next launch. */
export const EMBEDDED_RATES: Record<string, number> = {
  USD: 1, EUR: 0.92, GBP: 0.79, TRY: 34.2, JPY: 152, KRW: 1380,
  CNY: 7.2, INR: 84, BRL: 5.4, MXN: 19.8, AED: 3.67, SAR: 3.75,
  IDR: 15800, VND: 25400, THB: 33.5, PHP: 58, MYR: 4.45, SGD: 1.31,
  HKD: 7.78, TWD: 32.1, KES: 129, NGN: 1550, ZAR: 17.6, EGP: 48.5,
  ARS: 1190, CLP: 950, COP: 4350, PEN: 3.55, CAD: 1.38, AUD: 1.52,
  NZD: 1.66, CHF: 0.86, SEK: 10.5, NOK: 10.7, DKK: 6.86, PLN: 3.95,
  HUF: 360, CZK: 23.4, RON: 4.55, ILS: 3.65, MAD: 9.9, RUB: 96,
  UAH: 41.2, PKR: 278, BDT: 119, LKR: 305, NPR: 134, GHS: 15.4,
}

let rates: Record<string, number> = { ...EMBEDDED_RATES }
let ratesSource: FxState['source'] = 'embedded-fallback'
let ratesAt = 0

function storedOverride(): string {
  try {
    return localStorage.getItem(CUR_KEY) ?? 'auto'
  } catch {
    return 'auto'
  }
}

/** Device locale → currency: region tag wins, else the language's home
 *  region. USD only when the region genuinely uses it — never a guess. */
export function autoCurrency(): string {
  const region = deviceRegion()
  if (region && REGION_TO_CURRENCY[region]) return REGION_TO_CURRENCY[region]
  const langs = typeof navigator !== 'undefined' ? navigator.languages : []
  for (const tag of langs) {
    const base = tag.replace('_', '-').split('-')[0]?.toLowerCase() ?? ''
    const r = LANGUAGE_REGION[base]
    if (r && REGION_TO_CURRENCY[r]) return REGION_TO_CURRENCY[r]
  }
  return 'USD'
}

// ── tiny external store ────────────────────────────────────────────────
type Listener = () => void
const listeners = new Set<Listener>()
function emit() {
  listeners.forEach((l) => l())
}
function subscribe(l: Listener): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}

// useSyncExternalStore compares snapshots with Object.is — the snapshot
// MUST be a stable reference between emissions, or React re-renders in an
// infinite loop (error #185). Rebuild only when an input actually changed.
let snapshot: FxState | null = null
export function getFx(): FxState {
  const override = storedOverride()
  const currency = override === 'auto' ? autoCurrency() : override
  const rate = rates[currency] ?? 1
  if (
    !snapshot ||
    snapshot.override !== override ||
    snapshot.currency !== currency ||
    snapshot.rate !== rate ||
    snapshot.source !== ratesSource ||
    snapshot.fetchedAt !== ratesAt
  ) {
    snapshot = { currency, rate, source: ratesSource, fetchedAt: ratesAt, override }
  }
  return snapshot
}

export function useFx(): FxState {
  return useSyncExternalStore(subscribe, getFx, getFx)
}

/** Manual override ('auto' re-enables detection) — persists + analytics. */
export function setCurrency(code: string): void {
  const valid = code === 'auto' || ALL_CURRENCIES.includes(code)
  const next = valid ? code : 'auto'
  try {
    localStorage.setItem(CUR_KEY, next)
  } catch {
    /* non-fatal */
  }
  track('currency_changed', { code: next })
  emit()
}

/** First-ever auto resolution report (once per install). */
let autoReported = false
export function reportAutoCurrency(): void {
  if (autoReported) return
  autoReported = true
  try {
    if (localStorage.getItem(CUR_KEY)) return // user chose already
  } catch {
    /* ignore */
  }
  track('currency_auto', { code: autoCurrency() })
}

/** Convert + round for display. Zero-decimal → whole number up; else the
 *  local "x.99" convention (floor + .99). */
export function convertPrice(usd: number, currency: string, rate: number): number {
  const converted = usd * rate
  if (ZERO_DECIMAL.has(currency)) return Math.ceil(converted)
  return Math.floor(converted) + 0.99
}

export function formatLocalPrice(usd: number, fx: FxState, locale: string): string {
  const converted = convertPrice(usd, fx.currency, fx.rate)
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: fx.currency,
      minimumFractionDigits: ZERO_DECIMAL.has(fx.currency) ? 0 : 2,
      maximumFractionDigits: ZERO_DECIMAL.has(fx.currency) ? 0 : 2,
    }).format(converted)
  } catch {
    return `$${usd.toFixed(2)}`
  }
}

/** "≈ $16.99" — the transparency subline shown under the local price in
 *  checkout (and only there). */
export function formatApproxUSD(usd: number): string {
  return `≈ $${usd.toFixed(2)}`
}

/** Boot: cached rates are used immediately; a stale cache (>24 h) or no
 *  cache triggers one background fetch from our own server. */
export async function initFx(): Promise<void> {
  try {
    const raw = localStorage.getItem(FX_KEY)
    if (raw) {
      const cached = JSON.parse(raw) as { rates: Record<string, number>; fetchedAt: number }
      if (Date.now() - cached.fetchedAt < DAY && Object.keys(cached.rates).length > 50) {
        rates = cached.rates
        ratesSource = 'server'
        ratesAt = cached.fetchedAt
        emit()
        reportAutoCurrency()
        return
      }
    }
  } catch {
    /* fall through to fetch */
  }
  await refreshFx()
  reportAutoCurrency()
}

export async function refreshFx(): Promise<void> {
  try {
    const res = await fetch(`${CONFIG.apiUrl}/api/fx`)
    if (!res.ok) throw new Error(String(res.status))
    const json = (await res.json()) as { rates?: Record<string, number>; fetchedAt?: number }
    if (!json.rates || Object.keys(json.rates).length < 50) throw new Error('thin table')
    rates = json.rates
    ratesSource = 'server'
    ratesAt = json.fetchedAt ?? Date.now()
    try {
      localStorage.setItem(FX_KEY, JSON.stringify({ rates, fetchedAt: ratesAt }))
    } catch {
      /* non-fatal */
    }
  } catch {
    rates = { ...EMBEDDED_RATES }
    ratesSource = 'embedded-fallback'
    ratesAt = Date.now()
  }
  emit()
}
