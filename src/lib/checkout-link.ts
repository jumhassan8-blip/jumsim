/**
 * Store checkout link-out — the ONLY way to buy from the app.
 *
 * Store compliance: the app NEVER processes payment for digital goods.
 * Every purchase (eSIM plan, top-up, call credit) completes on
 * jumesim.com in the device's EXTERNAL browser.
 *
 * NEVER SILENT: every tap is logged, checked, and surfaced. If the URL
 * can't be opened (blocked webview, no browser, preview iframe) the app
 * shows an action sheet with the full link + Copy + retry — a dead
 * button is a bug, not an option.
 */
import { track } from './analytics'
import { CONFIG } from '../config'

/* ── configuration ────────────────────────────────────────────────────
 * EXPO_PUBLIC_CHECKOUT_URL is the store base (default jumesim.com).
 * A value that is empty or still a known placeholder ('example.com',
 * 'your-domain', 'REPLACE') means the store isn't configured — the CTA
 * renders a "Store opening soon" state instead of a dead link.
 */
// SINGLE SOURCE OF TRUTH: CONFIG.siteUrl (EXPO_PUBLIC_APP_URL / VITE_APP_URL,
// default https://jumesim.com). The legacy CHECKOUT_URL envs may still
// override, but the base config value is never duplicated here.
const RAW_BASE =
  (import.meta.env.EXPO_PUBLIC_CHECKOUT_URL as string | undefined) ??
  (import.meta.env.VITE_CHECKOUT_URL as string | undefined) ??
  CONFIG.siteUrl

const PLACEHOLDER_RE = /example\.com|your-domain|REPLACE|placeholder/i

function normalizeBase(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
}

const BASE = PLACEHOLDER_RE.test(RAW_BASE) ? '' : normalizeBase(RAW_BASE)

/** True when the store URL is configured and safe to open. */
export const checkoutConfigured: boolean = BASE.length > 0

export function checkoutBaseUrl(): string {
  return BASE
}

export interface CheckoutLinkParams {
  planId: string
  /** top-up of an existing eSIM — the site needs the target iccid */
  topUpFor?: string
  /** prefills the site's lightweight email field */
  email?: string
}

export function storeCheckoutUrl({ planId, topUpFor, email }: CheckoutLinkParams): string {
  const u = new URL('/checkout', BASE || CONFIG.siteUrl)
  u.searchParams.set('planId', planId)
  if (topUpFor) u.searchParams.set('topup', topUpFor)
  if (email) u.searchParams.set('email', email)
  return u.toString()
}

/** Call-credit top-up surface on the site. */
export function storeCreditUrl(email?: string): string {
  const u = new URL('/calls/topup', BASE || CONFIG.siteUrl)
  if (email) u.searchParams.set('email', email)
  return u.toString()
}

/* ── opening with full visibility ───────────────────────────────────── */

/**
 * Try every opener in order: native Linking (Capacitor/native builds) →
 * window.open new tab. Returns the URL if an opener accepted it, null
 * when every route failed (caller shows the sheet).
 */
function attemptOpen(url: string): boolean {
  // 1. Native bridge (real device builds)
  try {
    const w = window as unknown as {
      Capacitor?: { isNativePlatform?: () => boolean }
      cordova?: unknown
    }
    const cap = w.Capacitor
    if (cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform()) {
      const linking = (
        cap as unknown as { Plugins?: { App?: { openUrl?: (o: { url: string }) => Promise<void> } } }
      ).Plugins?.App
      if (linking?.openUrl) {
        linking.openUrl({ url }).catch(() => {})
        return true
      }
    }
  } catch {
    /* fall through to window.open */
  }
  // 2. Web: real new tab (never an in-app frame that could complete payment)
  try {
    const win = window.open(url, '_blank', 'noopener,noreferrer')
    if (win) return true
  } catch {
    /* fall through */
  }
  return false
}

function presentSheet(url: string): void {
  // Clipboard + retry, without pulling in the Capacitor dialog plugin:
  // a small inline overlay keeps web/preview builds dependency-free.
  const root = document.createElement('div')
  root.setAttribute('role', 'dialog')
  root.setAttribute('aria-label', 'Complete your purchase')
  root.style.cssText =
    'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.7);display:flex;align-items:flex-end;justify-content:center;font-family:inherit'
  const sheet = document.createElement('div')
  sheet.style.cssText =
    'width:100%;max-width:480px;background:#1C1C1E;border:1px solid #2A2A2C;border-radius:20px 20px 0 0;padding:20px;box-sizing:border-box'
  const title = document.createElement('p')
  title.textContent = 'Complete your purchase'
  title.style.cssText = 'margin:0 0 6px;font-size:17px;font-weight:700;color:#fff'
  const body = document.createElement('p')
  body.textContent = 'The store opens in your browser. If it did not open, use the link below.'
  body.style.cssText = 'margin:0 0 12px;font-size:13px;color:#9A9A9E;line-height:1.5'
  const linkBox = document.createElement('p')
  linkBox.textContent = url
  linkBox.style.cssText =
    'margin:0 0 16px;font-size:11px;word-break:break-all;color:#6E6E73;font-family:ui-monospace,Menlo,monospace;background:#0A0A0A;border-radius:10px;padding:10px'
  const row = document.createElement('div')
  row.style.cssText = 'display:flex;gap:10px'

  const mkBtn = (label: string, primary: boolean) => {
    const b = document.createElement('button')
    b.textContent = label
    b.style.cssText = `flex:1;min-height:48px;border:0;border-radius:12px;font-size:15px;font-weight:700;cursor:pointer;${
      primary ? 'background:#D7FF3F;color:#0A0A0A' : 'background:#2C2C2E;color:#fff'
    }`
    return b
  }
  const copyBtn = mkBtn('Copy link', false)
  copyBtn.onclick = () => {
    const done = () => {
      copyBtn.textContent = 'Copied ✓'
      // sheet stays open — the user may still want "Open anyway"
    }
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(url).then(done).catch(() => fallbackCopy(url, done))
    } else {
      fallbackCopy(url, done)
    }
  }
  const retryBtn = mkBtn('Open anyway', true)
  retryBtn.onclick = () => {
    console.log('[checkout-link] retry open:', url)
    if (attemptOpen(url)) close()
  }
  const closeBtn = mkBtn('Close', false)
  const close = () => root.remove()
  closeBtn.onclick = close
  root.onclick = (e) => {
    if (e.target === root) close()
  }
  row.append(copyBtn, retryBtn, closeBtn)
  sheet.append(title, body, linkBox, row)
  root.appendChild(sheet)
  document.body.appendChild(root)
}

function fallbackCopy(text: string, done: () => void): void {
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    ta.remove()
    done()
  } catch {
    /* clipboard unavailable — leave the link visible for manual copy */
  }
}

/**
 * Open the store checkout in the device's external browser.
 * LOGS the exact URL on every tap; if no opener works, an action sheet
 * with the full link + Copy + retry is shown. Zero silent no-ops.
 */
export function openStoreCheckout(params: CheckoutLinkParams): void {
  const url = storeCheckoutUrl(params)
  track('buy_linkout_tapped', { planId: params.planId, platform: 'web' })
  console.log('[checkout-link] open store checkout:', url)
  if (!attemptOpen(url)) {
    console.warn('[checkout-link] no opener accepted the URL — showing link sheet:', url)
    presentSheet(url)
  }
}

export function openStoreCredit(email?: string): void {
  const url = storeCreditUrl(email)
  track('buy_linkout_tapped', { planId: 'call_credit', platform: 'web' })
  console.log('[checkout-link] open store credit top-up:', url)
  if (!attemptOpen(url)) {
    console.warn('[checkout-link] no opener accepted the URL — showing link sheet:', url)
    presentSheet(url)
  }
}
