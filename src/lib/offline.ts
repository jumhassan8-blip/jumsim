/**
 * Offline resilience (Module 6).
 * Catalog is cached for 24h so the store opens offline; purchased eSIMs
 * already live in localStorage (lib/storage) and are always visible.
 */
import type { Country } from '../types'

const CATALOG_KEY = 'jum-esim:catalog-cache:v1'
const CATALOG_TTL_MS = 24 * 60 * 60 * 1000

interface CacheEntry {
  at: number
  countries: Country[]
}

export function cacheCatalog(countries: Country[]): void {
  try {
    localStorage.setItem(CATALOG_KEY, JSON.stringify({ at: Date.now(), countries }))
  } catch {
    /* non-fatal */
  }
}

/** fresh cached catalog, or null when stale/absent */
export function readCachedCatalog(): Country[] | null {
  try {
    const raw = localStorage.getItem(CATALOG_KEY)
    if (!raw) return null
    const entry = JSON.parse(raw) as CacheEntry
    if (Date.now() - entry.at > CATALOG_TTL_MS) return null
    return Array.isArray(entry.countries) ? entry.countries : null
  } catch {
    return null
  }
}

export function catalogCacheAgeMs(): number | null {
  try {
    const raw = localStorage.getItem(CATALOG_KEY)
    if (!raw) return null
    return Date.now() - (JSON.parse(raw) as CacheEntry).at
  } catch {
    return null
  }
}
