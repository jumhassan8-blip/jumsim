/**
 * Provider registry — selects the active eSIM provider from the
 * PROVIDER env var:
 *
 *   PROVIDER=esimaccess   eSIM Access  (DEFAULT — the new primary)
 *   PROVIDER=esimg        eSIM Go v2.4 (legacy, kept intact)
 *
 * Unknown/empty values fall back to the default. One instance per
 * process; the env is read once at first use so flipping PROVIDER and
 * restarting swaps providers with zero app/site changes.
 */
import type { EsimProvider } from './types'
import { createEsimAccessProvider, type EsimAccessDeps } from './esimAccess'
import { createEsimGoProvider, type EsimGoDeps } from './esimGo'

export const DEFAULT_PROVIDER = 'esimaccess'

export type ProviderName = 'esimaccess' | 'esimg'

export function activeProviderName(): ProviderName {
  const v = (process.env.PROVIDER ?? '').trim().toLowerCase()
  if (v === 'esimg' || v === 'esim-go' || v === 'esimgo') return 'esimg'
  return 'esimaccess' // default + unknown values
}

let instance: EsimProvider | null = null

export function getProvider(
  deps: { esimAccess?: EsimAccessDeps; esimGo?: EsimGoDeps } = {},
): EsimProvider {
  if (instance) return instance
  instance =
    activeProviderName() === 'esimg'
      ? createEsimGoProvider(deps.esimGo)
      : createEsimAccessProvider(deps.esimAccess)
  return instance
}

/** test hook — reset the cached instance */
export function __resetProviderForTests(): void {
  instance = null
}

/**
 * Coverage gate — decides whether a plan may be SOLD right now.
 *
 *   fulfillable  the active provider confirmed a package for this planId
 *   coming_soon  provider catalog loaded, plan NOT fulfilable → render
 *                "Coming soon", never pricing.json prices, never take money
 *   unknown      provider credentials absent — catalog can't be checked;
 *                render normally (fulfilment failures alert admins;
 *                refunds are user-requested only, never automatic)
 */
export type Coverage = 'fulfillable' | 'coming_soon' | 'unknown'

export async function planCoverage(planId: string): Promise<{ coverage: Coverage; packageCode?: string }> {
  const provider = getProvider()
  try {
    const pkg = await provider.resolvePackage(planId)
    return pkg ? { coverage: 'fulfillable', packageCode: pkg.packageCode } : { coverage: 'coming_soon' }
  } catch (err) {
    if (String(err).includes('not_configured')) return { coverage: 'unknown' }
    throw err
  }
}

/** true when the active provider's credentials are present */
export function providerConfigured(): boolean {
  if (activeProviderName() === 'esimg') return Boolean(process.env.ESIM_GO_API_KEY)
  return Boolean(process.env.ESIMA_ACCESS_CODE && process.env.ESIMA_SECRET_KEY)
}

export type {
  EsimProvider,
  ProviderPackage,
  InstallPayload,
  CreateOrderInput,
  CreateOrderResult,
  ProviderUsage,
  TopUpInput,
  WebhookRegistration,
} from './types'
