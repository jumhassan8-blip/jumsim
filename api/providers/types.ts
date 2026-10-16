/**
 * Server-side eSIM provider abstraction.
 *
 * The app and the checkout site never talk to a provider directly — all
 * provider traffic flows through adapters implementing this interface,
 * selected by the PROVIDER env var:
 *
 *   PROVIDER=esimaccess   → eSIM Access (DEFAULT for now)
 *   PROVIDER=esimg        → eSIM Go v2.4 (legacy, kept intact for the
 *                           later provider switch)
 *
 * Flipping PROVIDER swaps the entire backend to the other provider with
 * zero app/site changes — every route goes through getProvider().
 *
 * Normalization contract (adapters MUST conform):
 *   - prices: always USD, already divided by 10,000 where the source
 *     API multiplies (eSIM Access)
 *   - volumes: bytes; use volumeGB for display math
 *   - keys: esimTranNo is the PRIMARY eSIM key everywhere it exists
 *     (usage, topUp, cancel, webhook matching). iccid is a secondary
 *     display/install identifier.
 */

/** Normalized view of one purchasable package. */
export interface ProviderPackage {
  /** provider-side package code (eSIM Access: US_5_30; eSIM Go: SKU) */
  packageCode: string
  slug: string
  name: string
  /** ISO-3166 alpha-2 or provider region code (US, EU, GLOBAL…) */
  locationCode: string
  /** normalized USD */
  costUSD: number
  /** bytes; <= 0 means unlimited */
  volume: number
  /** convenience: volume / 1073741824, -1 = unlimited */
  volumeGB: number
  durationDays: number
  /** eSIM Access: 2 = top-up eligible */
  supportTopUpType?: number
}

/** Install payload for one eSIM — what the success page + app need. */
export interface InstallPayload {
  /** PRIMARY provider key — prefer this over iccid everywhere */
  esimTranNo: string
  providerOrderNo: string
  iccid: string
  qrUrl: string
  lpaString: string
  smdpAddress: string
  matchingId: string
  /** provider state, normalized to lowercase (released/got_resource/enabled/in_use/used_up/deleted) */
  status: string
  /** epoch ms when the package validity ends, if known */
  expiresAt?: number | null
  totalBytes?: number
}

export interface CreateOrderInput {
  planId: string
  email: string
  /** idempotency reference — must be unique per order (stripe pi id base) */
  reference: string
}

export interface CreateOrderResult {
  providerOrderNo: string
  /** eSIM Go returns the payload inline; eSIM Access provisions async
   *  (null → poll installPayload, or wait for the ORDER_STATUS webhook) */
  payload: InstallPayload | null
}

export interface ProviderUsage {
  esimTranNo: string
  totalBytes: number
  usedBytes: number
  /** normalized provider state */
  status: string
}

export interface TopUpInput {
  esimTranNo: string
  planId: string
  reference: string
}

export interface WebhookRegistration {
  ok: boolean
  /** what the provider currently reports as the webhook URL */
  current?: string
  error?: string
}

export interface EsimProvider {
  readonly name: 'esimaccess' | 'esimg'

  /** All packages the account can currently sell (drives the coverage filter). */
  catalog(): Promise<ProviderPackage[]>

  /**
   * Map one of OUR planIds ({slug}-unl-{days}d / {slug}-{gb}gb-{days}d /
   * {slug}-{bundle}) to a provider package. Returns null when the active
   * provider cannot fulfil the plan — callers render "Coming soon" and
   * MUST NOT take money for it.
   */
  resolvePackage(planId: string): Promise<ProviderPackage | null>

  /** Create a provider order. Money-moving: throws on any provider error. */
  createOrder(input: CreateOrderInput): Promise<CreateOrderResult>

  /**
   * Fetch the install payload for a provider order number.
   * Returns null while the eSIM is still provisioning (eSIM Access takes
   * 3–10s); throws on hard provider errors.
   */
  installPayload(providerOrderNo: string): Promise<InstallPayload | null>

  /** Live data usage. Keyed by esimTranNo (NOT iccid) for eSIM Access. */
  usage(esimTranNo: string): Promise<ProviderUsage>

  /** Add data to an existing eSIM. */
  topUp(input: TopUpInput): Promise<{ ok: boolean; providerOrderNo?: string }>

  /** Cancel an unused eSIM (provider refund where supported). */
  cancel(esimTranNo: string): Promise<{ ok: boolean }>

  /** Register the order-status webhook URL with the provider. */
  registerWebhook(url: string): Promise<WebhookRegistration>
}
