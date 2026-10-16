/**
 * pricing.json — the single source of truth for ALL prices.
 * Fetched once at launch, cached in memory; every price displayed in the
 * app comes from here (never hardcoded in components).
 */

export interface PricingPlan {
  label: string
  days?: number
  gb?: number
  price: number
  unitDisplay?: string
  tag?: string
}

export interface PricingCountry {
  tier: 1 | 2 | 3
  unlimited: PricingPlan[]
  data: PricingPlan[]
  callRates: { mobile: number; landline: number }
}

export interface NumberRentalEntry {
  monthlyUSD: number
  kycRequired: boolean
}

export interface PricingData {
  version: number
  generated: string
  currency: string
  fairUsePolicy: string
  tiers: Record<string, { wholesalePerGB: number; multiplier: number }>
  callRatesDefault: { mobile: number; landline: number }
  countries: Record<string, PricingCountry>
  /** Module 5 — number rental config */
  numberRental: {
    countries: Record<string, NumberRentalEntry>
    /** countries with no inventory left (waitlist only) */
    soldOut: string[]
    gracePeriodDays: number
    onePerUser: boolean
  }
  /** iso2 → dialing info for the number flow + dialer */
  dialCodes: Record<string, { dialCode: string; nationalPrefix: string }>
  /** country slug → iso2 (server price authority resolves plan ids) */
  slugs: Record<string, string>
}

let cache: Promise<PricingData> | null = null

export function loadPricing(): Promise<PricingData> {
  if (!cache) {
    cache = fetch(`${import.meta.env.BASE_URL}pricing.json`).then((res) => {
      if (!res.ok) throw new Error(`pricing.json fetch failed: ${res.status}`)
      return res.json() as Promise<PricingData>
    })
    // don't cache failures — allow retry on next call
    cache.catch(() => {
      cache = null
    })
  }
  return cache
}
