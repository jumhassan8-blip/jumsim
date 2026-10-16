import type { Purchase } from '../types'

const PURCHASES_KEY = 'jum-esim:purchases:v1'

export function loadPurchases(): Purchase[] {
  try {
    const raw = localStorage.getItem(PURCHASES_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? (parsed as Purchase[]) : []
  } catch {
    return []
  }
}

/** Fired (same tab) after every savePurchases — StoreContext re-reads the cache. */
export const PURCHASES_CHANGED_EVENT = 'jum-esim:purchases-changed'

export function savePurchases(purchases: Purchase[]): void {
  try {
    localStorage.setItem(PURCHASES_KEY, JSON.stringify(purchases))
    window.dispatchEvent(new CustomEvent(PURCHASES_CHANGED_EVENT))
  } catch {
    // storage full / private mode — purchases stay in memory for this session
  }
}
