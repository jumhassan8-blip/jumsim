/**
 * Reloadly adapter — thin REST wrapper behind the TopUpProvider interface.
 * Credentials come from env at REQUEST time (never cached at module scope):
 *
 *   RELOADLY_CLIENT_ID / RELOADLY_CLIENT_SECRET  (or RELOADLY_API_TOKEN for
 *   a pre-issued bearer)  ·  RELOADLY_BASE_URL (default sandbox)
 *
 * Access tokens are cached in-process until ~30s before expiry. Every call
 * logs provider + path + status + latency for the chargeback-defense audit
 * trail (brief §6) — bodies and tokens are never logged.
 */
import type {
  DetectedOperator,
  TopUpExecution,
  TopUpProduct,
  TopUpProvider,
  TopUpQuote,
} from './types'

const BASE = () => process.env.RELOADLY_BASE_URL ?? 'https://topups-sandbox.reloadly.com'

interface TokenState {
  token: string
  expiresAt: number
}
let tokenState: TokenState | null = null

async function accessToken(): Promise<string> {
  if (tokenState && tokenState.expiresAt > Date.now() + 30_000) return tokenState.token
  const id = process.env.RELOADLY_CLIENT_ID
  const secret = process.env.RELOADLY_CLIENT_SECRET
  const preIssued = process.env.RELOADLY_API_TOKEN
  if (preIssued) {
    tokenState = { token: preIssued, expiresAt: Number.MAX_SAFE_INTEGER }
    return preIssued
  }
  if (!id || !secret) throw new Error('reloadly_not_configured')
  const res = await fetch('https://auth.reloadly.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_id: id,
      client_secret: secret,
      grant_type: 'client_credentials',
      audience: BASE(),
    }),
  })
  if (!res.ok) throw new Error(`reloadly_auth_${res.status}`)
  const data = (await res.json()) as { access_token: string; expires_in?: number }
  tokenState = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  }
  return tokenState.token
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const started = Date.now()
  const token = await accessToken()
  const res = await fetch(`${BASE()}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  console.log(
    JSON.stringify({
      t: new Date().toISOString(),
      event: 'topup_provider_call',
      provider: 'reloadly',
      method,
      path: path.split('?')[0],
      status: res.status,
      latencyMs: Date.now() - started,
    }),
  )
  if (!res.ok) throw Object.assign(new Error(`reloadly_http_${res.status}`), { status: res.status })
  return (await res.json().catch(() => ({}))) as T
}

const QUOTE_TTL_MS = 60_000

export function createReloadlyProvider(): TopUpProvider {
  return {
    name: 'reloadly',
    async getCatalog(countryIso, operatorId) {
      const op = operatorId ? `?operatorId=${encodeURIComponent(operatorId)}` : `?countryIso=${encodeURIComponent(countryIso)}`
      const raw = await call<Array<{ id: number; name?: string; destination?: { amount?: number; currency?: string }; local?: { amount?: number; currency?: string }; validity?: string; fixedAmounts?: Array<{ amount?: number }> }>>('GET', `/operators${op}`)
      const products: TopUpProduct[] = []
      for (const entry of raw.slice(0, 50)) {
        const usd = entry.destination?.amount ?? entry.fixedAmounts?.[0]?.amount
        if (typeof usd !== 'number') continue
        const local = entry.local
        products.push({
          id: String(entry.id),
          kind: 'airtime',
          amountLocal: local ? `${local.currency} ${local.amount}` : `$${usd.toFixed(2)}`,
          amountUsd: usd,
          feeUsd: 0,
          validity: entry.validity ?? null,
          deliverText: entry.name ?? 'Airtime',
        })
      }
      return products
    },
    async detectOperator(msisdn) {
      const raw = await call<{ operatorId?: number; name?: string; ported?: boolean }>(
        'GET', `/operators/auto-detect/phone/${encodeURIComponent(msisdn)}/countries`,
      ).catch(() => null)
      if (!raw || raw.operatorId == null) return null
      return { id: String(raw.operatorId), name: raw.name ?? 'Unknown operator', detected: true }
    },
    async quote(productId, msisdn) {
      const raw = await call<{ amountUsd?: number; fee?: number }>(
        'POST', '/topups/quotes', { productId, msisdn },
      ).catch(() => ({ amountUsd: 0, fee: 0 }))
      const amountUsd = raw.amountUsd ?? 0
      const feeUsd = raw.fee ?? 0
      return {
        quoteId: `q_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        productId,
        msisdn,
        amountUsd,
        feeUsd,
        totalUsd: amountUsd + feeUsd,
        expiresAt: Date.now() + QUOTE_TTL_MS,
      }
    },
    async execute(quote) {
      const raw = await call<{ id?: number; status?: string }>('POST', '/topups', {
        productId: quote.productId,
        msisdn: quote.msisdn,
        amount: quote.amountUsd,
        customIdentifier: quote.quoteId,
      })
      return { providerRef: String(raw.id ?? quote.quoteId), status: 'processing' }
    },
    async status(providerRef) {
      const raw = await call<{ status?: string }>('GET', `/topups/${encodeURIComponent(providerRef)}`).catch(() => null)
      const s = raw?.status?.toUpperCase() ?? ''
      if (s.includes('SUCCESS')) return 'delivered'
      if (s.includes('FAIL')) return 'failed'
      if (s.includes('PEND')) return 'pending'
      return 'processing'
    },
    async refund(providerRef) {
      const res = await call<{ status?: string }>('POST', `/topups/${encodeURIComponent(providerRef)}/refund`).catch(() => null)
      return { ok: res !== null }
    },
  }
}
