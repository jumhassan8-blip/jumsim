/**
 * Mock top-up provider — deterministic fakes shaped exactly like the live
 * payloads, exercised by the e2e suite in MOCK_MODE. Also the stand-in when
 * PROVIDER_TOPUP=mock. Deterministic specials (MSISDN suffix —1 → delivered,
 * —2 → failed) let acceptance test BOTH lifecycle branches.
 */
import type {
  DetectedOperator,
  TopUpExecution,
  TopUpProduct,
  TopUpProvider,
  TopUpQuote,
} from './types'

const OPERATORS: Record<string, { id: string; name: string }> = {
  GH: { id: 'op_mtng', name: 'MTN Ghana' },
  TR: { id: 'op_turk', name: 'Turkcell' },
  NG: { id: 'op_mtnn', name: 'MTN Nigeria' },
  KE: { id: 'op_safk', name: 'Safaricom' },
}

const DENOM: Record<string, number[]> = {
  GH: [5, 10, 20, 50],
  TR: [5, 10, 25],
  NG: [5, 10, 20],
  KE: [5, 10, 15],
}

const QUOTE_TTL_MS = 60_000
const GHS = 7.9 // mock FX for local-currency display

export function createMockTopUpProvider(): TopUpProvider {
  return {
    name: 'mock',
    async getCatalog(countryIso, operatorId) {
      const iso = countryIso.toUpperCase()
      const denoms = DENOM[iso] ?? [5, 10, 20]
      const opName = OPERATORS[iso]?.name ?? `${iso} operator`
      const products: TopUpProduct[] = denoms.map((usd) => ({
        id: `${iso}-air-${usd}`,
        kind: 'airtime',
        amountLocal: iso === 'GH' ? `GHS ${Math.round(usd * GHS)}` : `${iso} ${usd * 5}`,
        amountUsd: usd,
        feeUsd: usd >= 20 ? 0.49 : 0.29,
        validity: null,
        deliverText: `${opName} airtime`,
      }))
      if (operatorId) return products
      products.push({
        id: `${iso}-data-1gb`,
        kind: 'data',
        amountLocal: `${iso} data`,
        amountUsd: denoms[denoms.length - 1] + 2,
        feeUsd: 0.49,
        validity: '30 days',
        deliverText: `${opName} 1 GB data bundle`,
      })
      return products
    },
    async detectOperator(msisdn) {
      const digits = msisdn.replace(/\D/g, '')
      const cc = digits.startsWith('233') ? 'GH' : digits.startsWith('90') ? 'TR' : digits.startsWith('234') ? 'NG' : digits.startsWith('254') ? 'KE' : null
      const op = cc ? OPERATORS[cc] : null
      if (!op) return null
      return { id: op.id, name: op.name, detected: true }
    },
    async quote(productId, msisdn) {
      const match = /-(\d+(?:\.\d+)?)$/.exec(productId)
      const base = match ? Number(match[1]) : 10
      const fee = base >= 20 ? 0.49 : 0.29
      return {
        quoteId: `q_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        productId,
        msisdn,
        amountUsd: base,
        feeUsd: fee,
        totalUsd: base + fee,
        expiresAt: Date.now() + QUOTE_TTL_MS,
      }
    },
    async execute(quote) {
      // deterministic outcome for e2e: msisdn ending —1 delivers, —2 fails
      const digits = quote.msisdn.replace(/\D/g, '')
      const failing = digits.endsWith('2')
      return { providerRef: `tu_${quote.quoteId}${failing ? '_F' : ''}`, status: 'processing' }
    },
    async status(providerRef) {
      if (providerRef.endsWith('_F')) return 'failed'
      // mock "network latency": first poll processing, later delivered
      const age = Date.now() - Number(/q_(\d+)_/.exec(providerRef)?.[1] ?? Date.now())
      return age > 1500 ? 'delivered' : 'processing'
    },
    async refund() {
      return { ok: true }
    },
  }
}
