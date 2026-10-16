import type { Country, Plan, Purchase, Usage } from '../types'

/**
 * Provider abstraction — the app only talks to this interface, and the
 * only implementation is BackendProvider. Store compliance: there is NO
 * order-creation or payment method on this interface — purchases complete
 * on jumesim.com in the external browser, and new eSIMs arrive via
 * Firestore users/{uid}/orders.
 */
export interface EsimProvider {
  readonly name: string

  /** 190+ countries + regional bundles */
  getCatalog(): Promise<Country[]>

  /** plans for one country (unlimited first is handled by the UI sort) */
  getProducts(countrySlug: string): Promise<Plan[]>

  /** live usage for an installed eSIM (server-authoritative) */
  getUsage(iccid: string, purchase: Purchase): Promise<Usage>

  /** refund/cancel within the provider activation window */
}

export class ProviderError extends Error {
  readonly code: 'network' | 'auth' | 'not_found' | 'unknown'

  constructor(message: string, code: 'network' | 'auth' | 'not_found' | 'unknown') {
    super(message)
    this.name = 'ProviderError'
    this.code = code
  }
}
