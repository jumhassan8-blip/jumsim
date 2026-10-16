/**
 * eSIM Go v2.4 adapter — the ORIGINAL provider integration, kept intact
 * behind PROVIDER=esimg for the later provider switch.
 *
 * Auth: Bearer ESIM_GO_API_KEY + X-Merchant-Id header.
 * SKU mapping lives in env (server-side): ESIMGO_SKU_{planId} with
 * ESIMGO_DEFAULT_SKU fallback — same contract the checkout webhook
 * always used.
 *
 * eSIM Go returns the install payload INLINE at order creation (unlike
 * eSIM Access, which provisions async). esimTranNo does not exist on
 * this provider — the iccid doubles as the primary key, and the adapter
 * surfaces it as `esimTranNo` so callers stay provider-agnostic.
 */
import type {
  CreateOrderInput,
  CreateOrderResult,
  EsimProvider,
  InstallPayload,
  ProviderPackage,
  ProviderUsage,
  TopUpInput,
  WebhookRegistration,
} from './types'
import { withBackoff, RetryableError } from './rateLimit'

const BASE = 'https://api.esim-go.com/v2.4'

export interface EsimGoDeps {
  fetchImpl?: typeof fetch
}

interface EsimGoEsim {
  iccid: string
  qrUrl?: string
  lpastr?: string
  smdp?: string
  matchingId?: string
}

function skuFor(planId: string): string | null {
  return process.env[`ESIMGO_SKU_${planId}`] ?? process.env.ESIMGO_DEFAULT_SKU ?? null
}

export function createEsimGoProvider(deps: EsimGoDeps = {}): EsimProvider {
  const fetchImpl = deps.fetchImpl ?? fetch

  function headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${process.env.ESIM_GO_API_KEY ?? ''}`,
      'Content-Type': 'application/json',
      'X-Merchant-Id': process.env.ESIMGO_MERCHANT_ID ?? '',
    }
  }

  async function rawOrderCreate(input: CreateOrderInput): Promise<InstallPayload> {
    const sku = skuFor(input.planId)
    if (!sku) throw new Error('esimgo_sku_not_configured')
    if (!process.env.ESIM_GO_API_KEY) throw new Error('esimgo_key_missing')
    const res = await fetchImpl(`${BASE}/orders`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        type: 'bundle',
        sku,
        quantity: 1,
        reference: input.reference,
        notificationEmail: input.email,
      }),
    })
    if (!res.ok) throw new Error(`esimgo_http_${res.status}`)
    const data = (await res.json()) as { order?: Array<{ esims?: EsimGoEsim[] }> }
    const esim = data.order?.[0]?.esims?.[0]
    if (!esim?.iccid) throw new Error('esimgo_no_esim_in_response')
    const smdp = esim.smdp ?? 'lp-1.esimgo.com'
    return {
      // eSIM Go has no esimTranNo — iccid is the primary key
      esimTranNo: esim.iccid,
      providerOrderNo: input.reference,
      iccid: esim.iccid,
      qrUrl: esim.qrUrl ?? '',
      lpaString: esim.lpastr ?? `LPA:1$${smdp}$${esim.matchingId ?? ''}`,
      smdpAddress: smdp,
      matchingId: esim.matchingId ?? '',
      status: 'released',
    }
  }

  async function createOrder(input: CreateOrderInput): Promise<CreateOrderResult> {
    const payload = await withBackoff(() => rawOrderCreate(input))
    return { providerOrderNo: payload.providerOrderNo, payload }
  }

  async function installPayload(providerOrderNo: string): Promise<InstallPayload | null> {
    // eSIM Go returns payloads inline at creation; for re-fetch we would
    // need the order id (not the reference) — the app gets the payload
    // from Firestore, so this path is only a creation-time concern.
    void providerOrderNo
    return null
  }

  async function catalog(): Promise<ProviderPackage[]> {
    // eSIM Go fulfilment is SKU-env-driven, not catalog-driven; the
    // coverage filter treats every plan with a configured SKU as
    // fulfillable. Kept empty on purpose — resolvePackage is the source
    // of truth for this provider.
    return []
  }

  async function resolvePackage(planId: string): Promise<ProviderPackage | null> {
    const sku = skuFor(planId)
    if (!sku) return null
    return {
      packageCode: sku,
      slug: planId,
      name: planId,
      locationCode: '',
      costUSD: 0, // cost tracked in eSIM Go dashboard, not exposed here
      volume: 0,
      volumeGB: -1,
      durationDays: 0,
    }
  }

  async function usage(esimTranNo: string): Promise<ProviderUsage> {
    if (!process.env.ESIM_GO_API_KEY) throw new Error('esimgo_key_missing')
    const res = await fetchImpl(`${BASE}/esims/${encodeURIComponent(esimTranNo)}`, {
      headers: { Authorization: `Bearer ${process.env.ESIM_GO_API_KEY}` },
    })
    if (!res.ok) throw new Error(`esimgo_http_${res.status}`)
    // v2.4 esim status payload — parse the fields we rely on defensively
    const data = (await res.json()) as {
      status?: string
      totalMB?: number
      totalMb?: number
      totalBytes?: number
    }
    const totalBytes = data.totalBytes ?? (data.totalMB ?? data.totalMb ?? 0) * 1048576
    const status = (data.status ?? '').toLowerCase()
    return {
      esimTranNo,
      totalBytes,
      usedBytes: totalBytes,
      status,
    }
  }

  async function topUp(input: TopUpInput): Promise<{ ok: boolean; providerOrderNo?: string }> {
    // eSIM Go tops up by ordering another bundle against the same eSIM —
    // the checkout webhook records `topUpFor` and the app reconciles, so
    // a fresh order IS the top-up mechanism.
    const created = await createOrder({
      planId: input.planId,
      email: '',
      reference: input.reference,
    })
    void input.esimTranNo
    return { ok: true, providerOrderNo: created.providerOrderNo }
  }

  async function cancel(esimTranNo: string): Promise<{ ok: boolean }> {
    if (!process.env.ESIM_GO_API_KEY) throw new Error('esimgo_key_missing')
    const res = await fetchImpl(`${BASE}/esims/${encodeURIComponent(esimTranNo)}/cancel`, {
      method: 'POST',
      headers: headers(),
    })
    // 4xx = not in a cancellable state (already activated) — not a fault
    if (!res.ok) return { ok: false }
    return { ok: true }
  }

  async function registerWebhook(url: string): Promise<WebhookRegistration> {
    // eSIM Go webhook delivery is configured in the merchant dashboard,
    // not via API. The existing /api/webhooks/esimgo handler stays as-is.
    return { ok: true, current: url, error: 'configure_in_esimgo_dashboard' }
  }

  return {
    name: 'esimg',
    catalog,
    resolvePackage,
    createOrder,
    installPayload,
    usage,
    topUp,
    cancel,
    registerWebhook,
  }
}

/** kept for the webhook path — the raw inline creation used before the
 *  adapter refactor, so existing ledger rows remain replay-compatible */
export { RetryableError }
