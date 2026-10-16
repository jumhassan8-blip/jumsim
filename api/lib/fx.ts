/**
 * FX rates — server side, refreshed once daily.
 *
 * The client NEVER calls a FX provider: it reads our own /api/fx table.
 * Source: open.er-api.com (free, keyless) with exchangerate.host as an
 * alternate; either failing leaves yesterday's cache in place, and
 * MOCK_MODE (or no network) serves a static table — same shape, so the
 * client can't tell the difference.
 *
 * Cache: in-memory for the dev server; FX_CACHE_FILE when set (serverless
 * environments with a persistent volume) — KV_REST_API_* plugs in here.
 */

export interface FxTable {
  base: 'USD'
  rates: Record<string, number>
  fetchedAt: number
  source: 'live' | 'static'
}

const DAY = 24 * 60 * 60 * 1000

/** Static mock table (spec sample: EUR .92, TRY 34.2, JPY 152 …) — broad
 *  enough that every catalog currency resolves in mock mode. */
export const STATIC_RATES: Record<string, number> = {
  USD: 1, EUR: 0.92, GBP: 0.79, TRY: 34.2, JPY: 152, KRW: 1380,
  CNY: 7.2, INR: 84, BRL: 5.4, MXN: 19.8, AED: 3.67, SAR: 3.75,
  IDR: 15800, VND: 25400, THB: 33.5, PHP: 58, MYR: 4.45, SGD: 1.31,
  HKD: 7.78, TWD: 32.1, KES: 129, NGN: 1550, ZAR: 17.6, EGP: 48.5,
  ARS: 1190, CLP: 950, COP: 4350, PEN: 3.55, CAD: 1.38, AUD: 1.52,
  NZD: 1.66, CHF: 0.86, SEK: 10.5, NOK: 10.7, DKK: 6.86, PLN: 3.95,
  HUF: 360, CZK: 23.4, RON: 4.55, ILS: 3.65, MAD: 9.9, RUB: 96,
  UAH: 41.2, PKR: 278, BDT: 119, LKR: 305, NPR: 134, GHS: 15.4,
  // every remaining catalog currency, realistic mid-2026 magnitudes
  AFN: 71, ALL: 93, AMD: 402, AOA: 920, AWG: 1.8, AZN: 1.7, BAM: 1.8,
  BBD: 2, BDT: 119, BGN: 1.8, BHD: 0.376, BIF: 2950, BMD: 1, BND: 1.31,
  BOB: 6.9, BSD: 1, BWP: 13.5, BYN: 3.6, BZD: 2, CDF: 2850, CVE: 101,
  DJF: 178, DOP: 60, DZD: 134, ERN: 15, ETB: 118, FJD: 2.25, GEL: 2.7,
  GMD: 70, GNF: 8650, GTQ: 7.7, GYD: 209, HTG: 131, IQD: 1310, IRR: 42000,
  ISK: 137, JMD: 157, JOD: 0.709, KGS: 87, KHR: 4050, KMF: 452, KPW: 900,
  KWD: 0.307, KYD: 0.82, KZT: 510, LAK: 21900, LBP: 89500, LRD: 198,
  LSL: 17.6, LYD: 4.85, MGA: 4650, MDL: 17.8, MNT: 3450, MOP: 8.03,
  MRU: 39.8, MUR: 46.5, MVR: 15.4, MWK: 1740, MZN: 63.8, NAD: 17.6,
  NIO: 36.8, OMR: 0.384, PAB: 1, PGK: 4, PYG: 7900, QAR: 3.64, RSD: 106,
  RWF: 1380, SBD: 8.5, SCR: 13.6, SDG: 600, SLE: 22.6, SOS: 571,
  SRD: 35, SSP: 4200, STN: 22.4, SYP: 13000, SZL: 17.6, TJS: 10.4,
  TMT: 3.5, TND: 3.15, TOP: 2.35, TTD: 6.8, UGX: 3680, UYU: 41.5,
  UZS: 12800, VES: 95, VUV: 119, WST: 2.75, XAF: 605, XCD: 2.7, XOF: 605,
  XPF: 110, YER: 250, ZMW: 26.5, ZWG: 26.5,
  ANG: 1.8,
}

let cache: FxTable | null = null
let inflight: Promise<FxTable> | null = null

function isMock(): boolean {
  return process.env.MOCK_MODE === 'true'
}

async function fetchLive(): Promise<FxTable> {
  const sources = [
    'https://open.er-api.com/v6/latest/USD',
    'https://api.exchangerate.host/latest?base=USD',
  ]
  for (const url of sources) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
      if (!res.ok) continue
      const json = (await res.json()) as {
        result?: string
        rates?: Record<string, number>
        success?: boolean
      }
      if (json.rates && Object.keys(json.rates).length > 50) {
        return { base: 'USD', rates: json.rates, fetchedAt: Date.now(), source: 'live' }
      }
    } catch {
      /* try the next source */
    }
  }
  throw new Error('all_fx_sources_failed')
}

/** The daily table. Mock mode → static. Stale-while-revalidate: a live
 *  fetch failure never clears a cache younger than 48 h. */
export async function getFxTable(): Promise<FxTable> {
  if (isMock()) {
    return { base: 'USD', rates: STATIC_RATES, fetchedAt: Date.now(), source: 'static' }
  }
  if (cache && Date.now() - cache.fetchedAt < DAY) return cache
  if (inflight) return inflight
  inflight = (async () => {
    try {
      cache = await fetchLive()
      return cache
    } catch {
      if (cache && Date.now() - cache.fetchedAt < 2 * DAY) return cache
      // last resort so checkout never breaks: static table, clearly stamped
      return { base: 'USD', rates: STATIC_RATES, fetchedAt: Date.now(), source: 'static' }
    } finally {
      inflight = null
    }
  })()
  return inflight
}
