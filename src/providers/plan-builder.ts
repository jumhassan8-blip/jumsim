import type { Country, Plan, PlanGroup } from '../types'
import { loadPricing, type PricingData } from '../data/pricing'
import { buildPlanId } from '../lib/plan-id'

/**
 * Regional bundles keep their own wholesale-derived tables until eSIM Go
 * bundle SKUs are mapped; everything else comes straight from pricing.json.
 * Used by BackendProvider.
 */
const BUNDLE_PLANS: Record<string, Array<{
  group: PlanGroup
  label: string
  dataGB: number | 'unlimited'
  days: number
  wholesale: number
  tag?: string
}>> = {
  europe: [
    { group: 'data', label: '5 GB', dataGB: 5, days: 30, wholesale: 7.0 },
    { group: 'data', label: '10 GB', dataGB: 10, days: 30, wholesale: 12.3, tag: 'POPULAR' },
    { group: 'data', label: '20 GB', dataGB: 20, days: 30, wholesale: 19.3, tag: 'BEST VALUE' },
    { group: 'unlimited', label: '15 Days', dataGB: 'unlimited', days: 15, wholesale: 21.0 },
  ],
  'asia-pacific': [
    { group: 'data', label: '3 GB', dataGB: 3, days: 15, wholesale: 5.2 },
    { group: 'data', label: '5 GB', dataGB: 5, days: 30, wholesale: 7.0, tag: 'POPULAR' },
    { group: 'data', label: '10 GB', dataGB: 10, days: 30, wholesale: 12.3 },
    { group: 'unlimited', label: '15 Days', dataGB: 'unlimited', days: 15, wholesale: 18.4 },
  ],
  global: [
    { group: 'data', label: '5 GB', dataGB: 5, days: 365, wholesale: 19.9 },
    { group: 'data', label: '10 GB', dataGB: 10, days: 365, wholesale: 33.9, tag: 'BESTSELLER' },
    { group: 'data', label: '20 GB', dataGB: 20, days: 365, wholesale: 54.0, tag: 'BEST VALUE' },
  ],
}

const FUP_NOTE = 'Fair-usage high-speed, then reduced speed'

/** Build the retail plan list for a country from pricing.json (+ bundle tables). */
export function buildPlansForCountry(country: Country, pricing: PricingData): Plan[] {
  const bundle = BUNDLE_PLANS[country.slug]
  if (bundle) {
    return bundle.map((b) => ({
      id: buildPlanId(country.slug, 'bundle', { bundleLabel: b.label.replace(' ', '').toLowerCase() }),
      countrySlug: country.slug,
      name: `${b.label} · ${country.name}`,
      dataGB: b.dataGB,
      days: b.days,
      priceUSD: Math.max(0.99, Math.round(b.wholesale * 1.3) - 0.01),
      wholesaleUSD: b.wholesale,
      fiveG: country.fiveG,
      networks: country.networks,
      hotspot: true,
      group: b.group,
      label: b.label,
      unitDisplay:
        b.dataGB === 'unlimited'
          ? undefined
          : `${(Math.max(0.99, Math.round(b.wholesale * 1.3) - 0.01) / b.dataGB).toFixed(2)} USD/GB`,
      tag: b.tag,
      fairUseNote: b.dataGB === 'unlimited' ? FUP_NOTE : undefined,
    }))
  }

  const entry = pricing.countries[country.iso2]
  if (!entry) return []
  const wholesalePerGB = pricing.tiers[String(entry.tier)].wholesalePerGB
  const plans: Plan[] = []
  for (const u of entry.unlimited) {
    plans.push({
      id: buildPlanId(country.slug, 'unlimited', { days: u.days ?? 0 }),
      countrySlug: country.slug,
      name: `Unlimited · ${country.name}`,
      dataGB: 'unlimited',
      days: u.days ?? 0,
      priceUSD: u.price,
      // estimated wholesale: FUP cap 2.5GB/day × days × tier wholesale
      wholesaleUSD: Math.round(wholesalePerGB * 2.5 * (u.days ?? 0) * 100) / 100,
      fiveG: country.fiveG,
      networks: country.networks,
      hotspot: true,
      group: 'unlimited',
      label: u.label,
      tag: u.tag,
      fairUseNote: pricing.fairUsePolicy,
    })
  }
  for (const d of entry.data) {
    plans.push({
      id: buildPlanId(country.slug, 'data', { gb: d.gb ?? 0, days: d.days ?? 30 }),
      countrySlug: country.slug,
      name: `${d.gb}GB · ${country.name}`,
      dataGB: d.gb ?? 0,
      days: d.days ?? 30,
      priceUSD: d.price,
      wholesaleUSD: Math.round(wholesalePerGB * (d.gb ?? 0) * 100) / 100,
      fiveG: country.fiveG,
      networks: country.networks,
      hotspot: true,
      group: 'data',
      label: d.label,
      unitDisplay: d.unitDisplay,
      tag: d.tag,
    })
  }
  return plans
}

export function getPricingOnce(): Promise<PricingData> {
  return loadPricing()
}
