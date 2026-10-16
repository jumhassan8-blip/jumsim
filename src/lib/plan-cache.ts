/**
 * Plan cache (checkout never re-fetches).
 *
 * The country plan list populates this cache when it loads plans; checkout
 * reads from it. On a cold deep link the cache is empty — checkout fills it
 * once for that country and reuses it. Catalog + pricing.json load once at
 * app start in StoreContext; this layer reuses the same loadPricing cache.
 */
import type { Plan } from '../types'

const cache = new Map<string, Plan[]>()

export function cachePlans(countrySlug: string, plans: Plan[]): void {
  cache.set(countrySlug, plans)
}

/** returns null when this country's plans aren't cached yet */
export function readPlans(countrySlug: string): Plan[] | null {
  return cache.get(countrySlug) ?? null
}

export function findPlan(plans: Plan[], planId: string): Plan | undefined {
  return plans.find((p) => p.id === planId)
}

/** every plan id currently known — for trace logging on a lookup miss */
export function allKnownPlanIds(): string[] {
  return [...cache.values()].flat().map((p) => p.id)
}
