/**
 * eSIM Access adapter — https://api.esimaccess.com/api/v1/open
 *
 * Auth: every request is a POST with HMAC-SHA256 signed headers:
 *   RT-AccessCode / RT-Timestamp / RT-RequestID / RT-Signature
 *   signStr       = timestamp + requestId + accessCode + requestBody
 *   RT-Signature  = HMAC_SHA256(signStr, key)  (lowercase hex)
 *
 *   Per the official API reference the sign key is the secretKey with the
 *   accessCode mixed into the sign string. (A variant of the docs signs
 *   with the accessCode as key; if your account follows that variant set
 *   ESIMA_SIGN_KEY=accesscode.)
 *
 * Quirks normalized here:
 *   - prices are ×10,000  → costUSD = price / 10000
 *   - volumes are bytes   → volumeGB = volume / 1073741824
 *   - ~8 req/s rate limit → token bucket + exponential backoff
 *   - esimTranNo is the PRIMARY eSIM key (usage/topup/cancel/webhooks);
 *     iccid is kept only as a secondary install identifier
 *   - createOrder provisions ASYNC (3–10s) → installPayload polls
 *     /esim/query by orderNo; the ORDER_STATUS webhook is the fallback
 *
 * Credentials (server-only env): ESIMA_ACCESS_CODE, ESIMA_SECRET_KEY
 */
import crypto from 'node:crypto'
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
import { createRateLimiter, withBackoff, RetryableError, type RateLimiter } from './rateLimit'
import { parsePlanId, loadPricing } from '../lib/pricing'

const BASE = 'https://api.esimaccess.com/api/v1/open'
const BYTES_PER_GB = 1073741824
const CATALOG_TTL_MS = 15 * 60 * 1000

/** bundle slug → candidate provider location codes (matched case-insensitively
 *  against the codes the account's catalog actually returns) */
const BUNDLE_LOCATION_CANDIDATES: Record<string, string[]> = {
  europe: ['EU', 'EUROPE', 'EURO'],
  'asia-pacific': ['APAC', 'ASIA', 'ASIA-PACIFIC', 'ASIAPACIFIC'],
  global: ['GLOBAL', 'GL', 'WORLD', 'INT', 'INTERNATIONAL'],
}

export interface EsimAccessDeps {
  /** injectable for tests (defaults to global fetch) */
  fetchImpl?: typeof fetch
  limiter?: RateLimiter
  sleepFn?: (ms: number) => Promise<void>
  now?: () => number
  uuid?: () => string
  /** override catalog/keys — tests */
  accessCode?: string
  secretKey?: string
}

interface ApiEsim {
  esimTranNo?: string
  orderNo?: string
  iccid?: string
  qrCodeUrl?: string
  shortUrl?: string
  smdpStatus?: string
  esimStatus?: string
  ac?: string
  totalVolume?: number
  totalDuration?: number
  expiredTime?: string | null
  activateTime?: string | null
}

interface ApiPackage {
  packageCode: string
  slug?: string
  name?: string
  price?: number
  volume?: number
  duration?: number
  location?: string
  supportTopUpType?: number
  activeType?: number
}

export function bytesToGB(bytes: number): number {
  if (bytes <= 0) return -1 // unlimited sentinel
  return Math.round((bytes / BYTES_PER_GB) * 100) / 100
}

export function parseApiTime(s: string | null | undefined): number | null {
  if (!s) return null
  // "2026-10-07T21:13:01+0000" → normalize offset for Date.parse
  const norm = s.replace(/([+-]\d{2})(\d{2})$/, '$1:$2')
  const t = Date.parse(norm)
  return Number.isNaN(t) ? null : t
}

export function createEsimAccessProvider(deps: EsimAccessDeps = {}): EsimProvider {
  const fetchImpl = deps.fetchImpl ?? fetch
  const limiter = deps.limiter ?? createRateLimiter({ capacity: 8, refillPerSec: 8 })
  const now = deps.now ?? Date.now
  const uuid = deps.uuid ?? (() => crypto.randomUUID())
  const sleepFn = deps.sleepFn

  const accessCode = () => deps.accessCode ?? process.env.ESIMA_ACCESS_CODE ?? ''
  const secretKey = () => deps.secretKey ?? process.env.ESIMA_SECRET_KEY ?? ''
  const configured = () => Boolean(accessCode() && secretKey())

  function signHeaders(body: string): Record<string, string> {
    const timestamp = String(now())
    const requestId = uuid()
    const signStr = timestamp + requestId + accessCode() + body
    const key = process.env.ESIMA_SIGN_KEY === 'accesscode' ? accessCode() : secretKey()
    const signature = crypto.createHmac('sha256', key).update(signStr).digest('hex').toLowerCase()
    return {
      'Content-Type': 'application/json',
      'RT-AccessCode': accessCode(),
      'RT-Timestamp': timestamp,
      'RT-RequestID': requestId,
      'RT-Signature': signature,
    }
  }

  /** One rate-limited, backoff-wrapped API call. Throws on permanent errors. */
  async function call<T>(endpoint: string, body: Record<string, unknown>): Promise<T> {
    if (!configured()) throw new Error('esiaccess_not_configured')
    return withBackoff(
      async () => {
        await limiter.acquire()
        let res: Response
        try {
          res = await fetchImpl(`${BASE}${endpoint}`, {
            method: 'POST',
            headers: signHeaders(JSON.stringify(body)),
            body: JSON.stringify(body),
          })
        } catch (err) {
          // network failure — retryable
          throw new RetryableError(`esiaccess_network: ${String(err)}`)
        }
        if (!res.ok) {
          const text = await res.text().catch(() => '')
          const retryable = res.status === 429 || res.status >= 500
          throw new (retryable ? RetryableError : Error)(`esiaccess_http_${res.status} ${text.slice(0, 200)}`, res.status)
        }
        const data = (await res.json()) as { success?: boolean; errorCode?: string; errorMsg?: string | null; obj?: unknown }
        if (data.success !== true) {
          // documented business errors are permanent (see api-reference error table)
          throw new Error(`esiaccess_${data.errorCode ?? 'error'}: ${data.errorMsg ?? endpoint}`)
        }
        return data.obj as T
      },
      { sleep: sleepFn },
    )
  }

  /* ── catalog ─────────────────────────────────────────────────────────── */

  let catalogCache: { at: number; promise: Promise<ProviderPackage[]> } | null = null

  function rawPackageList(): Promise<{ packageList?: ApiPackage[] }> {
    return call<{ packageList?: ApiPackage[] }>('/package/list', {
      locationCode: '',
      type: '',
      slug: '',
      packageCode: '',
      iccid: '',
    })
  }

  function normalizePackage(p: ApiPackage): ProviderPackage {
    const volume = typeof p.volume === 'number' ? p.volume : 0
    return {
      packageCode: p.packageCode,
      slug: p.slug ?? p.packageCode,
      name: p.name ?? p.packageCode,
      locationCode: (p.location ?? '').toUpperCase(),
      costUSD: Math.round((p.price ?? 0) / 10) / 1000, // ×10000 → USD, 5dp-safe
      volume,
      volumeGB: bytesToGB(volume),
      durationDays: p.duration ?? 30,
      supportTopUpType: p.supportTopUpType,
    }
  }

  async function catalog(): Promise<ProviderPackage[]> {
    if (catalogCache && now() - catalogCache.at < CATALOG_TTL_MS) return catalogCache.promise
    const promise = rawPackageList().then((obj) => (obj.packageList ?? []).map(normalizePackage))
    catalogCache = { at: now(), promise }
    // never cache a rejection — drop it so the next call retries
    promise.catch(() => {
      if (catalogCache?.promise === promise) catalogCache = null
    })
    return promise
  }

  /* ── plan resolution (our planId grammar → provider package) ────────── */

  function locationCandidates(slug: string): string[] {
    const bundles = BUNDLE_LOCATION_CANDIDATES[slug]
    if (bundles) return bundles
    // country slug → ISO: pricing.slugs maps slug→iso when it differs
    // (germany→de); when absent the slug IS the iso lowercased (jp→JP)
    const { loadPricing } = require('../lib/pricing') as typeof import('../lib/pricing')
    const iso = (loadPricing().slugs?.[slug] ?? slug).toUpperCase().replace(/[^A-Z0-9]/g, '')
    return [iso]
  }

  function normCode(s: string): string {
    return s.toUpperCase().replace(/[^A-Z0-9]/g, '')
  }

  async function resolvePackage(planId: string): Promise<ProviderPackage | null> {
    // explicit per-plan override wins (mirrors the ESIMGO_SKU_ pattern):
    //   ESIMA_PKG_GERMANY-UNL-7D=EU_7_30   (any non-alnum → _)
    const envKey = `ESIMA_PKG_${planId.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`
    const override = process.env[envKey]
    const packages = await catalog()
    if (override) {
      const hit = packages.find((p) => p.packageCode === override)
      if (hit) return hit
      // override set but not in the live catalog → do NOT silently fall
      // back to guessing; report unfulfillable instead.
      return null
    }

    const parsed = parsePlanId(planId)
    if (!parsed) return null
    const codes = locationCandidates(parsed.slug).map(normCode)
    const inLocation = packages.filter((p) => codes.includes(normCode(p.locationCode)))
    if (inLocation.length === 0) return null

    if (parsed.kind === 'unlimited') {
      return (
        inLocation.find((p) => p.volume <= 0 && p.durationDays === parsed.days) ??
        inLocation.find((p) => p.volume <= 0) ?? // any unlimited for the location
        null
      )
    }
    let wantGB: number | null = null
    if (parsed.kind === 'data') {
      wantGB = parsed.gb ?? null
    } else {
      // bundle label like "10gb" (labels were normalized when built)
      const m = (parsed.bundleLabel ?? '').match(/^(\d+(?:p5)?)gb$/)
      wantGB = m ? Number(m[1].replace('p5', '.5')) : null
    }
    if (wantGB === null) return null
    const wantDays = parsed.days ?? null
    return (
      inLocation.find(
        (p) => p.volumeGB === wantGB && (wantDays === null || p.durationDays === wantDays),
      ) ?? null
    )
  }

  /* ── orders / install payload ────────────────────────────────────────── */

  async function createOrder(input: CreateOrderInput): Promise<CreateOrderResult> {
    const pkg = await resolvePackage(input.planId)
    if (!pkg) throw new Error(`esiaccess_unfulfillable_plan:${input.planId}`)
    const transactionId = input.reference.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64)
    const obj = await call<{ orderNo?: string; transactionId?: string }>('/esim/order', {
      transactionId,
      packageInfoList: [{ packageCode: pkg.packageCode, count: 1 }],
    })
    if (!obj.orderNo) throw new Error('esiaccess_no_order_no')
    return { providerOrderNo: obj.orderNo, payload: null }
  }

  function normalizeEsim(esim: ApiEsim): InstallPayload | null {
    // still provisioning — iccid/qr not assigned yet
    if (!esim.iccid && !esim.qrCodeUrl) return null
    return {
      // esimTranNo is the PRIMARY key — iccid is secondary everywhere
      esimTranNo: esim.esimTranNo ?? esim.iccid ?? '',
      providerOrderNo: esim.orderNo ?? '',
      iccid: esim.iccid ?? '',
      qrUrl: esim.qrCodeUrl ?? '',
      // eSIM Access returns an install QR URL; LPA string is only built
      // when the profile carries explicit smdp/matching fields
      lpaString: esim.ac ? `LPA:1$${esim.ac}$${esim.esimTranNo ?? ''}` : '',
      smdpAddress: esim.ac ?? '',
      matchingId: esim.esimTranNo ?? '',
      status: (esim.esimStatus ?? esim.smdpStatus ?? '').toLowerCase(),
      expiresAt: parseApiTime(esim.expiredTime),
      totalBytes: typeof esim.totalVolume === 'number' ? esim.totalVolume : undefined,
    }
  }

  async function installPayload(providerOrderNo: string): Promise<InstallPayload | null> {
    const obj = await call<{ esimList?: ApiEsim[] }>('/esim/query', {
      orderNo: providerOrderNo,
      iccid: '',
      pager: { pageNum: 1, pageSize: 5 },
    })
    const esim = obj.esimList?.[0]
    if (!esim) return null
    return normalizeEsim(esim)
  }

  /* ── usage (keyed by esimTranNo — NOT iccid) ─────────────────────────── */

  async function usage(esimTranNo: string): Promise<ProviderUsage> {
    const obj = await call<Record<string, unknown>>('/esim/usage/query', {
      esimTranNoList: [esimTranNo],
    })
    // response list field is not in the public reference — parse defensively
    const list: Array<Record<string, unknown>> = Array.isArray(obj)
      ? (obj as Array<Record<string, unknown>>)
      : ((obj.esimUsageList ?? obj.usageList ?? obj.list ?? obj.esimList ?? []) as Array<Record<string, unknown>>)
    const row = list[0] ?? {}
    const num = (...keys: string[]): number => {
      for (const k of keys) {
        const v = row[k]
        if (typeof v === 'number' && Number.isFinite(v)) return v
      }
      return 0
    }
    return {
      esimTranNo,
      usedBytes: num('orderUsage', 'usedVolume', 'usage', 'usedBytes', 'used'),
      totalBytes: num('totalVolume', 'totalBytes', 'volume', 'total'),
      status: String(row.esimStatus ?? row.status ?? '').toLowerCase(),
    }
  }

  /* ── top-up / cancel ─────────────────────────────────────────────────── */

  async function topUp(input: TopUpInput): Promise<{ ok: boolean; providerOrderNo?: string }> {
    const pkg = await resolvePackage(input.planId)
    if (!pkg) throw new Error(`esiaccess_unfulfillable_plan:${input.planId}`)
    const transactionId = input.reference.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64)
    const obj = await call<{ orderNo?: string }>('/esim/topup', {
      esimTranNo: input.esimTranNo,
      iccid: '',
      packageCode: pkg.packageCode,
      transactionId,
    })
    return { ok: true, providerOrderNo: obj.orderNo }
  }

  async function cancel(esimTranNo: string): Promise<{ ok: boolean }> {
    try {
      await call('/esim/cancel', { esimTranNo })
      return { ok: true }
    } catch (err) {
      // 200002 "status doesn't support action" → the eSIM is already
      // activated; cancel simply doesn't apply. Not a retryable fault.
      const msg = String(err)
      if (msg.includes('esiaccess_200002') || msg.includes('esiaccess_200003')) return { ok: false }
      throw err
    }
  }

  /* ── webhook registration ────────────────────────────────────────────── */

  async function registerWebhook(url: string): Promise<WebhookRegistration> {
    await call('/webhook/save', { webhookUrl: url })
    try {
      const q = await call<{ webhook?: string }>('/webhook/query', {})
      return { ok: true, current: q.webhook ?? url }
    } catch {
      return { ok: true, current: url }
    }
  }

  return {
    name: 'esimaccess',
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
