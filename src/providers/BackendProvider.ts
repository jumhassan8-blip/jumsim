import type { Country, Plan, Purchase, Usage } from '../types'
import { buildCountries } from '../data/catalog'
import { loadPricing } from '../data/pricing'
import { ProviderError, type EsimProvider } from './EsimProvider'
import { buildPlansForCountry } from './plan-builder'
import { withRetry } from '../lib/retry'
import { CONFIG } from '../config'

/**
 * Backend provider — catalog/plans come from pricing.json (single source
 * of truth, available offline via the service worker); usage, refund
 * eligibility and call balances are SERVER-computed:
 *
 *   POST /api/usage   → server-reported usage for an eSIM
 *   POST /api/refund  → refund/cancel within the provider window
 *
 * Store compliance: the app NEVER creates orders or payments — purchases
 * complete on jumesim.com (Stripe + eSIM Go live there), and the new
 * eSIM appears in My eSIMs via Firestore users/{uid}/orders.
 */

export class BackendProvider implements EsimProvider {
  readonly name = 'backend'
  private catalog: Country[] | null = null

  private url(path: string): string {
    return `${CONFIG.apiUrl}/api${path}`
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    let res: Response
    try {
      res = await withRetry(() =>
        fetch(this.url(path), {
          ...init,
          headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
        }),
      )
    } catch (err) {
      if (err instanceof ProviderError) throw err
      throw new ProviderError('Network error reaching Jum servers', 'network')
    }
    if (res.status === 401 || res.status === 403) {
      throw new ProviderError('Backend auth failed — check server env vars', 'auth')
    }
    if (res.status === 404) {
      throw new ProviderError('Not found', 'not_found')
    }
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      throw new ProviderError(body.error ?? `Backend error (${res.status})`, 'unknown')
    }
    return (await res.json()) as T
  }

  async getCatalog(): Promise<Country[]> {
    if (!this.catalog) this.catalog = buildCountries()
    return this.catalog
  }

  async getProducts(countrySlug: string): Promise<Plan[]> {
    const catalog = this.catalog ?? (this.catalog = buildCountries())
    const country = catalog.find((c) => c.slug === countrySlug)
    if (!country) throw new ProviderError(`Unknown country: ${countrySlug}`, 'not_found')
    const pricing = await loadPricing()
    const plans = buildPlansForCountry(country, pricing)
    if (plans.length === 0) {
      throw new ProviderError(`No pricing data for ${country.iso2}`, 'not_found')
    }
    return plans
  }

  /**
   * Usage is SERVER-AUTHORITATIVE: the client asks /api/usage and renders
   * whatever the provider reports. Fail closed — a failure throws (the UI
   * shows an honest error + support path); it never fabricates numbers.
   */
  getUsage(iccid: string, _purchase: Purchase): Promise<Usage> {
    return this.request<Usage>('/usage', {
      method: 'POST',
      body: JSON.stringify({ iccid }),
    })
  }
}
