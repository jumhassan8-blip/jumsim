/**
 * Top-up provider seam (brief §2). One interface, env-switched
 * implementations behind PROVIDER_TOPUP:
 *
 *   reloadly | ding | prepay
 *
 * NORMALIZED everywhere below — no provider-shaped objects ever cross
 * this boundary. When NO provider is configured, `resolveTopUpProvider`
 * returns null and EVERY surface renders the designed "coming soon /
 * waitlist" state (never fabricated operators or prices).
 */

export type TopUpKind = 'airtime' | 'data'

export interface TopUpProduct {
  id: string
  kind: TopUpKind
  /** face value in the destination currency, e.g. "GHS 50" */
  amountLocal: string
  amountUsd: number
  /** our fee, always shown pre-pay */
  feeUsd: number
  /** e.g. "30 days" for bundles; null for open-value airtime */
  validity: string | null
  /** what the recipient actually gets, human copy */
  deliverText: string
}

export interface TopUpQuote {
  quoteId: string
  productId: string
  msisdn: string
  amountUsd: number
  feeUsd: number
  totalUsd: number
  /** ms epoch — server refuses to execute a stale quote (re-quote flow) */
  expiresAt: number
}

export interface TopUpExecution {
  providerRef: string
  status: 'processing' | 'delivered'
}

export interface DetectedOperator {
  id: string
  name: string
  /** true when the provider resolved the MSISDN (authoritative for ported numbers) */
  detected: boolean
}

export interface TopUpProvider {
  readonly name: string
  getCatalog(countryIso: string, operatorId?: string): Promise<TopUpProduct[]>
  /** MSISDN lookup is provider-authoritative (ported numbers). */
  detectOperator(msisdn: string): Promise<DetectedOperator | null>
  quote(productId: string, msisdn: string): Promise<TopUpQuote>
  execute(quote: TopUpQuote, msisdn: string): Promise<TopUpExecution>
  status(providerRef: string): Promise<'pending' | 'processing' | 'delivered' | 'failed'>
  refund(providerRef: string): Promise<{ ok: boolean }>
}
