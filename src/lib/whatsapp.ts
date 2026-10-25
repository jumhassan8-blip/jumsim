/**
 * WhatsApp Business support — single source for both link forms and the ONE
 * shared open routine used by every support surface (Help top row + the
 * error/support footers: install failure, connection-test failure, checkout
 * payment failure).
 *
 * The number lives in CONFIG.whatsapp.number and is referenced ONLY from
 * here, so swapping the business number is a one-line config change.
 *
 * Tap behavior (never a dead button):
 *   1. Build BOTH links from one prefill:
 *        app: whatsapp://send?phone=<number>&text=<encoded>   → opens the
 *             WhatsApp app DIRECTLY into the chat (message prefilled)
 *        web: https://wa.me/<number>?text=<encoded>            → browser,
 *             "Continue to Chat" → WhatsApp Web
 *   2. Native builds inject the Linking adapter (expo-linking) once via
 *      setWhatsAppLinking(): canOpenURL(app) true → openURL(app); false or
 *      any error → openURL(web). NEVER a crash, NEVER a dead end.
 *   3. Web/browser builds open the wa.me https URL directly (window.open,
 *      location.href as last resort) — opening wa.me in a new tab there is
 *      expected behavior, not a bug.
 *
 * REQUIRED native config (see app.config.js + README — without it
 * canOpenURL ALWAYS returns false and the app path never fires):
 *   iOS:     Info.plist LSApplicationQueriesSchemes += "whatsapp"
 *   Android: AndroidManifest.xml <queries><package android:name="com.whatsapp"/>
 *            (Android 11+ package visibility)
 */
import { CONFIG } from '../config'
import { track } from './analytics'

export type WhatsAppSurface = 'profile' | 'install_fail' | 'connection_fail' | 'checkout_fail'

export interface SupportContext {
  orderId?: string
  plan?: string
  country?: string
}

interface LinkingLike {
  canOpenURL(url: string): Promise<boolean>
  openURL(url: string): Promise<void>
}

/** Injected by the native (Expo) wrapper with expo-linking's Linking. */
let nativeLinking: LinkingLike | null = null
export function setWhatsAppLinking(linking: LinkingLike | null): void {
  nativeLinking = linking
}

/** Prefilled opener so users type only their problem, not their order details. */
export function buildSupportPrefill(ctx?: SupportContext): string {
  if (ctx?.orderId) {
    const plan = [ctx.plan, ctx.country].filter(Boolean).join(', ')
    return `Hi Jum e-SIM! I need help with my order ${ctx.orderId}${plan ? ` — ${plan}` : ''}. My issue: `
  }
  return 'Hi Jum e-SIM! I need help with: '
}

/** Primary — opens the WhatsApp app directly into the chat. */
export function whatsappAppUrl(prefill?: string): string {
  const text = prefill ? `&text=${encodeURIComponent(prefill)}` : ''
  return `whatsapp://send?phone=${CONFIG.whatsapp.number}${text}`
}

/** Fallback — browser → "Continue to Chat" → WhatsApp Web (always works). */
export function whatsappWebUrl(prefill?: string): string {
  const text = prefill ? `?text=${encodeURIComponent(prefill)}` : ''
  return `https://wa.me/${CONFIG.whatsapp.number}${text}`
}

export function openInBrowser(url: string): void {
  try {
    window.open(url, '_blank', 'noopener,noreferrer')
  } catch {
    window.location.href = url
  }
}

/**
 * Open WhatsApp to our business number. Prefers the native app scheme
 * (lands INSIDE WhatsApp, chat pre-filled) and falls back to the wa.me web
 * URL (browser → "Continue to Chat") — no crash, no dead end. Logs any
 * error with the surface. Returns the app URL (native) or web URL (browser)
 * it attempted so tests and the native wrapper can assert on it.
 * Never throws.
 */
export function openWhatsApp(
  surface: WhatsAppSurface,
  ctx?: SupportContext,
  /** explicit prefill override (e.g. the rating prompt's low-rating message) */
  prefillOverride?: string,
): string {
  track('whatsapp_support_tapped', { surface, hasOrderContext: Boolean(ctx?.orderId) })
  const prefill = prefillOverride ?? buildSupportPrefill(ctx)
  const appUrl = whatsappAppUrl(prefill)
  const webUrl = whatsappWebUrl(prefill)

  if (nativeLinking) {
    const linking = nativeLinking
    linking
      .canOpenURL(appUrl)
      .then((supported) => (supported ? linking.openURL(appUrl) : linking.openURL(webUrl)))
      .then(undefined, (err: unknown) => {
        // canOpenURL threw OR openURL failed — log (error + surface) and
        // land the user in the browser fallback
        // eslint-disable-next-line no-console
        console.error('[whatsapp] Linking failed, falling back to wa.me', { surface, appUrl, err })
        openInBrowser(webUrl)
      })
    return appUrl
  }

  try {
    openInBrowser(webUrl)
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[whatsapp] open failed', { surface, webUrl, err })
    window.location.href = webUrl
  }
  return webUrl
}
