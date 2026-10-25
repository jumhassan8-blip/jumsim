/**
 * GET /api/checkout/plan — resolve a planId (or list candidates) for the
 * jumesim.com web checkout. The SERVER is the price authority: display
 * names and prices come from pricing.json here — the site never trusts
 * URL params for money.
 *
 *   GET /api/checkout/plan?planId=germany-unl-7d
 *     → { plan: { id, name, subtitle, priceUSD, days, dataGB } }
 *   GET /api/checkout/plan
 *     → { plans: [ ...popular entries ] }   (picker fallback)
 */
import { sendJson, corsOrigin } from '../lib/http'
import { authoritativePrice, loadPricing, type ParsedPlanId } from '../lib/pricing'
import { planCoverage, type Coverage } from '../providers'
import countryNames from '../data/country-names.json'

const NAMES = countryNames as Record<string, string>
/** regional bundles that aren't countries */
const BUNDLE_NAMES: Record<string, string> = {
  europe: 'Europe Regional',
  'asia-pacific': 'Asia Pacific',
  global: 'Global 190+ Countries',
}

function displayName(slug: string, iso: string): string {
  return BUNDLE_NAMES[slug] ?? NAMES[iso] ?? slug
}

interface PlanView {
  id: string
  name: string
  subtitle: string
  /** null when coverage='coming_soon' — never show a price we can't honour */
  priceUSD: number | null
  days: number | null
  dataGB: number | 'unlimited' | null
}

function buildView(planId: string, parsed: ParsedPlanId, price: number, iso: string): PlanView {
  const place = displayName(parsed.slug, iso)
  let days: number | null = null
  let dataGB: number | 'unlimited' | null = null
  let subtitle: string
  let name: string
  if (parsed.kind === 'unlimited') {
    days = parsed.days ?? null
    dataGB = 'unlimited'
    name = `${place} · Unlimited`
    subtitle = `${days} day${days === 1 ? '' : 's'} · fair-usage high speed`
  } else if (parsed.kind === 'data') {
    dataGB = parsed.gb ?? null
    days = parsed.days ?? 30
    name = `${place} · ${dataGB}GB`
    subtitle = `${days} day${days === 1 ? '' : 's'} · 5G where available`
  } else {
    name = place
    subtitle = 'Regional bundle · 5G where available'
  }
  return { id: planId, name, subtitle, priceUSD: price, days, dataGB }
}

/** popular picker list (same shape as a single-plan response, batched) */
function popularPlans(): PlanView[] {
  const pricing = loadPricing()
  const out: PlanView[] = []
  for (const iso of ['DE', 'GB', 'US', 'JP', 'TH', 'ID']) {
    const c = pricing.countries[iso]
    if (!c) continue
    const slug = iso.toLowerCase()
    const u = c.unlimited.find((p) => p.days === 7) ?? c.unlimited[0]
    if (u) {
      out.push({
        id: `${slug}-unl-${u.days}d`,
        name: `${NAMES[iso] ?? iso} Unlimited`,
        subtitle: `Unlimited data · ${u.days} days`,
        priceUSD: u.price,
        days: u.days,
        dataGB: 'unlimited',
      })
    }
    const d = c.data.find((p) => (p.gb ?? 0) === 5) ?? c.data[0]
    if (d) {
      out.push({
        id: `${slug}-${d.gb}gb-${d.days ?? 30}d`,
        name: `${NAMES[iso] ?? iso} ${d.gb}GB`,
        subtitle: `${d.gb}GB · ${d.days ?? 30} days`,
        priceUSD: d.price,
        days: d.days ?? 30,
        dataGB: d.gb ?? null,
      })
    }
  }
  return out
}

/**
 * Coverage filter — only plans the ACTIVE PROVIDER can actually fulfil are
 * sellable. Everything else is "Coming soon" and its pricing.json price is
 * stripped from the response (never show a price we can't honour).
 */
async function applyCoverage(view: PlanView): Promise<{ view: PlanView; coverage: Coverage }> {
  const { coverage } = await planCoverage(view.id)
  if (coverage !== 'coming_soon') return { view, coverage }
  return { view: { ...view, priceUSD: null }, coverage }
}

export default async function handler(
  req: import('node:http').IncomingMessage,
  res: import('node:http').ServerResponse,
): Promise<void> {
  const origin = corsOrigin(req)
  if (origin) res.setHeader('Access-Control-Allow-Origin', origin)
  const url = new URL(req.url ?? '/', (process.env.APP_ORIGIN ?? 'https://jumesim.com').split(',')[0].trim())
  const planId = url.searchParams.get('planId')
  if (!planId) {
    // picker fallback — filter out plans the active provider can't fulfil
    let plans = popularPlans()
    try {
      const checked = await Promise.all(plans.map(applyCoverage))
      plans = checked.filter((c) => c.coverage !== 'coming_soon').map((c) => c.view)
    } catch {
      // provider unreachable — keep the picker usable; the single-plan
      // gate + fulfilment guarantee are the backstops
    }
    sendJson(res, 200, { plans })
    return
  }
  const r = authoritativePrice(planId)
  if (!r.ok || r.expected === null || !r.parsed) {
    sendJson(res, 404, { error: 'unknown_plan' })
    return
  }
  const pricing = loadPricing()
  const iso = (pricing.slugs?.[r.parsed.slug] ?? r.parsed.slug).toUpperCase()
  const view = buildView(planId, r.parsed, r.expected, iso)
  try {
    const { view: covered, coverage } = await applyCoverage(view)
    sendJson(res, 200, { plan: covered, coverage })
  } catch {
    sendJson(res, 200, { plan: view, coverage: 'unknown' })
  }
}
