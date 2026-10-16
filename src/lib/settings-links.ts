// Settings deep links — capability detection + guarded open.
//
// This app ships as a mobile web app / installable PWA, so the "Linking"
// layer from the native spec maps to:
//   - canOpenURL  → canOpenUrl(): best-effort probe (window.open, catch reject)
//   - openURL     → tryOpenSettings(): probes first, never throws, reports failure
//   - Expo Go / no-intent-launcher → non-standalone browser: buttons are
//     replaced by written path instructions, so there is no dead button.

export const isAndroidDevice = () => /android/i.test(navigator.userAgent)
export const isIosDevice = () => /iPhone|iPad|iPod/.test(navigator.userAgent)

/** True when launched as an installed PWA (home-screen icon), i.e. a "real
 *  device" context where settings deep links are meaningful. A plain browser
 *  tab — including every preview — is treated as preview. */
export function isInstalledPwa(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean }
  return Boolean(
    (typeof window.matchMedia === 'function' &&
      window.matchMedia('(display-mode: standalone)').matches) ||
      nav.standalone === true,
  )
}

export type SettingsEnv = 'ios-device' | 'android-device' | 'preview'

export function detectSettingsEnv(): SettingsEnv {
  if (isInstalledPwa()) {
    if (isAndroidDevice()) return 'android-device'
    if (isIosDevice()) return 'ios-device'
  }
  return 'preview'
}

/**
 * Best-effort canOpenURL for the web. Attempts a real open and reports whether
 * it succeeded. Never throws — a rejected call resolves to false, and the
 * caller must show the manual fallback (same contract as Linking.canOpenURL).
 */
export async function canOpenUrl(url: string): Promise<boolean> {
  try {
    const win = window.open(url, '_blank')
    if (!win) return false // popup/deep-link blocked → cannot open
    // Give the OS a beat to hand the URL off, then close the probe tab if the
    // scheme was unknown (browser leaves it on about:blank).
    window.setTimeout(() => {
      try {
        if (win.location.href === 'about:blank') win.close()
      } catch {
        /* cross-origin or already handed off — fine */
      }
    }, 600)
    return true
  } catch {
    return false
  }
}

export interface OpenAttempt {
  ok: boolean
}

/**
 * Guarded open: probe first (canOpenURL), then hand off. Any failure resolves
 * to { ok: false } — callers show the inline manual-path fallback. Never a
 * dead button, never an unhandled rejection.
 */
export async function tryOpenSettings(url: string): Promise<OpenAttempt> {
  const ok = await canOpenUrl(url)
  return { ok }
}
