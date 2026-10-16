import pricingJson from '../data/pricing.json'

/**
 * pricing.json is the single source of truth for plans AND prices.
 * The server validates every order against it (price authority) — the
 * client can never dictate a price.
 *
 * Mirrors src/lib/plan-id.ts — the same plan-ID grammar on both sides.
 */
export interface ParsedPlanId {
  slug: string
  kind: 'unlimited' | 'data' | 'bundle'
  days?: number
  gb?: number
  bundleLabel?: string
}

export interface PricingData {
  version: number
  currency: string
  fairUsePolicy: string
  countries: Record<string, {
    tier: number
    unlimited: Array<{ label: string; days: number; price: number; tag?: string }>
    data: Array<{ label: string; gb: number; price: number; unitDisplay?: string; tag?: string; days?: number }>
    callRates?: { mobile: number; landline: number }
  }>
  slugs?: Record<string, string>
}

// bundled copy ships inside the function (imported above so every bundler
// traces and includes it — Vercel zero-config, esbuild, tsc alike)
const pricing = pricingJson as PricingData

export function loadPricing(): PricingData {
  return pricing
}

export function parsePlanId(planId: string): ParsedPlanId | null {
  let m = planId.match(/^(.*)-unl-(\d+)d$/)
  if (m) return { slug: m[1], kind: 'unlimited', days: Number(m[2]) }
  m = planId.match(/^(.*)-(\d+(?:p5)?)gb-(\d+)d$/)
  if (m) return { slug: m[1], kind: 'data', gb: Number(m[2].replace('p5', '.5')), days: Number(m[3]) }
  m = planId.match(/^(.*)-(.+)$/)
  if (m) return { slug: m[1], kind: 'bundle', bundleLabel: m[2] }
  return null
}

export function roundCents(n: number): number {
  return Math.round(n * 100) / 100
}

export interface PriceAuthorityResult {
  ok: boolean
  expected: number | null
  parsed: ParsedPlanId | null
}

/**
 * Regional bundles — same wholesale-derived table as
 * src/providers/plan-builder.ts (kept in sync until eSIM Go bundle SKUs are
 * mapped). Retail formula mirrors the client: max(0.99, round(w*1.3)-0.01).
 */
const BUNDLES: Record<string, Array<{ label: string; wholesale: number }>> = {
  europe: [
    { label: '5 GB', wholesale: 7.0 },
    { label: '10 GB', wholesale: 12.3 },
    { label: '20 GB', wholesale: 19.3 },
  ],
  'asia-pacific': [
    { label: '3 GB', wholesale: 5.2 },
    { label: '5 GB', wholesale: 7.0 },
    { label: '10 GB', wholesale: 12.3 },
  ],
  global: [
    { label: '5 GB', wholesale: 19.9 },
    { label: '10 GB', wholesale: 33.9 },
    { label: '20 GB', wholesale: 54.0 },
  ],
}

function bundlePrice(slug: string, bundleLabel: string | undefined): number | null {
  const b = BUNDLES[slug]?.find(
    (x) => x.label.toLowerCase().replace(/[^a-z0-9]+/g, '') === bundleLabel,
  )
  if (!b) return null
  return Math.max(0.99, Math.round(b.wholesale * 1.3) - 0.01)
}

/**
 * Server price authority: resolve planId against pricing.json and, when the
 * client sends a price, verify it matches to the cent. A null client price
 * skips the equality check but still validates the plan exists.
 */
export function authoritativePrice(planId: string, clientPrice?: number): PriceAuthorityResult {
  const parsed = parsePlanId(planId)
  if (!parsed) return { ok: false, expected: null, parsed: null }

  // regional bundles resolve against the wholesale table, not a country
  if (parsed.kind === 'bundle' && BUNDLES[parsed.slug]) {
    const price = bundlePrice(parsed.slug, parsed.bundleLabel)
    if (price === null) return { ok: false, expected: null, parsed }
    if (clientPrice === undefined) return { ok: true, expected: price, parsed }
    return { ok: roundCents(Number(clientPrice)) === roundCents(price), expected: price, parsed }
  }

  const pricing = loadPricing()
  const iso = (pricing.slugs?.[parsed.slug] ?? parsed.slug).toUpperCase()
  const c = pricing.countries[iso]
  if (!c) return { ok: false, expected: null, parsed }

  let plan: { price: number; days?: number } | null = null
  if (parsed.kind === 'unlimited') {
    plan = c.unlimited.find((p) => p.days === parsed.days) ?? null
  } else if (parsed.kind === 'data') {
    plan = c.data.find((p) => (p.gb ?? 0) === parsed.gb && (p.days ?? 30) === parsed.days) ?? null
  } else {
    plan =
      c.data.find((p) => p.label?.toLowerCase().replace(/[^a-z0-9]+/g, '') === parsed.bundleLabel) ??
      null
  }
  if (!plan) return { ok: false, expected: null, parsed }

  if (clientPrice === undefined) return { ok: true, expected: plan.price, parsed }
  const okMatch = roundCents(Number(clientPrice)) === roundCents(plan.price)
  return { ok: okMatch, expected: plan.price, parsed }
}
