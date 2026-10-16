/**
 * Central config — production flags, provider, legal/support surfaces.
 *
 * NO SECRETS HERE. Every key lives in server-side env vars (see /.env.example);
 * the client only holds public config + feature flags. Production is
 * FAIL-CLOSED: there is one provider (our backend, which holds the eSIM Go
 * key) and no fallback anywhere.
 */
import supportJson from '../config/support.json'

export const CONFIG_VALUES = {
  brand: 'Jum e-SIM',
  tagline: 'Global eSIM Store',

  /** single source of truth for retail markup over wholesale */
  markup: 1.3,

  currency: 'USD',

  /**
   * PUBLIC APP BASE URL — THE single config value for every absolute link
   * to this product (checkout redirects, install/email links, legal pages,
   * deep links, share URLs). Override with EXPO_PUBLIC_APP_URL (native
   * builds) or VITE_APP_URL (web). Never hardcode a domain in a component.
   * Canonical production value: https://jumesim.com
   */
  siteUrl: (() => {
    const raw =
      (import.meta.env.EXPO_PUBLIC_APP_URL as string | undefined) ??
      (import.meta.env.VITE_APP_URL as string | undefined) ??
      'https://jumesim.com'
    const trimmed = raw.trim().replace(/\/$/, '')
    return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  })(),

  /**
   * All provider/payment calls go through the Vercel serverless functions in
   * api/ (same-origin `/api/*` by default) — the client NEVER talks to
   * eSIM Go or Stripe directly; all secrets live in server-side env vars.
   * Catalog/plans come from pricing.json (single source of truth, available
   * offline via the service worker); orders, install payloads, usage,
   * refunds and balances are server-computed via the api routes.
   */
  provider: 'backend' as const,

  /**
   * Backend base URL. '' = same-origin (Vercel deployment or the local
   * vite proxy to `npm run api`). Override with VITE_API_URL for a split
   * frontend/backend setup.
   */
  apiUrl: (import.meta.env.VITE_API_URL as string | undefined) ?? '',

  /**
   * STORE COMPLIANCE: the app contains NO payment code. All purchases
   * (eSIM plans, top-ups, call credit) complete on jumesim.com in the
   * device's external browser — see src/lib/checkout-link.ts. Stripe,
   * Apple Pay and Google Pay live only on the website checkout.
   */

  supportEmail: 'support@jumesim.com',

  /**
   * WhatsApp Business support — the number is defined ONCE in
   * config/support.json ({ "whatsappNumber": "23233129788" }) and imported
   * here; everything reads CONFIG.whatsapp.number. Never hardcode the
   * digits in a component. wa.me links open a chat without saving the
   * contact (key for travelers).
   */
  whatsapp: {
    /** digits only — single source: config/support.json → whatsappNumber */
    number: supportJson.whatsappNumber as string,
    /** pretty-printed for display */
    display: '+232 33 129 788',
  },

  /** Calls tab (VoIP over the eSIM's data; Twilio Voice behind /api/calls/*) */
  calls: {
    /** call-time packs sold in the Buy Time sheet */
    packsUSD: [3, 5, 10, 20] as readonly number[],
    /** a call can only start with ≥ this many seconds of credit at the destination rate */
    minStartSeconds: 60,
    /** in-call banner when this many seconds of credit remain */
    lowCreditSeconds: 60,
    /** call credit validity, in months (from each purchase) */
    creditExpiresMonths: 12,
    /** emergency services must go over the regular SIM — never VoIP */
    emergencyNumbers: ['112', '911', '999'] as readonly string[],
    /** false → Calls tab hidden entirely (kill switch, no deploy needed) */
    enabled: true,
  },

  /** app version stamped into support emails / chat context */
  version: (import.meta.env.VITE_APP_VERSION as string | undefined) ?? 'dev',

  /** hosted legal pages — URLs only, content lives on the site. Built
   *  from siteUrl so the whole app tracks the single config value. */
  legal: {
    privacy: `${'https://jumesim.com' as string}/privacy`,
    terms: `${'https://jumesim.com' as string}/terms`,
    refunds: `${'https://jumesim.com' as string}/refund`,
  },

  /**
   * Support chat ("Jum Assistant") — every message POSTs to
   * /api/support/chat (LLM + kb.md server-side). An unreachable backend
   * surfaces the email fallback — never a canned local reply.
   */
  support: {
    assistantName: 'Jum Assistant',
  },

  /** observability — empty string = disabled (no-op stubs) */
  analytics: {
    posthogKey: (import.meta.env.VITE_POSTHOG_KEY as string | undefined) ?? '',
    posthogHost: 'https://app.posthog.com',
  },
  crashReporting: {
    sentryDsn: (import.meta.env.VITE_SENTRY_DSN as string | undefined) ?? '',
  },

  /** per-country kill switch — ISO codes hidden from the catalog */
  disabledCountries: [] as string[],

  /** activation window for free refund on failed installs (minutes) */
  activationWindowMinutes: 15,

  /** order attempts allowed per minute, per device (client guard; server enforces too) */
  orderRateLimitPerMinute: 5,

} as const

/** Public config — typed from the values object, with legal URLs
 *  rebuilt from siteUrl so the whole app tracks the single config value. */
const base = CONFIG_VALUES

export const CONFIG: typeof CONFIG_VALUES = {
  ...base,
  legal: {
    privacy: `${base.siteUrl}/privacy`,
    terms: `${base.siteUrl}/terms`,
    refunds: `${base.siteUrl}/refund`,
  },
}
