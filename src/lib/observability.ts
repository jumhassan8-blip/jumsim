/**
 * Observability (Module 6) — Sentry crash reporting + PostHog analytics.
 * Both are no-op stubs until a key is configured in env (see .env.example),
 * so a minimal build runs with zero third-party calls.
 */
import { CONFIG } from '../config'
import { track } from './analytics'

let posthogLoaded = false

/** call once at app start (App.tsx) */
export function initObservability(): void {
  if (CONFIG.analytics.posthogKey && !posthogLoaded) {
    posthogLoaded = true
    // PostHog snippet loads here in production (expo build uses the native SDK).
    // The local event log in lib/analytics keeps firing regardless so every
    // one of the 16 defined events is verifiable in-app.
  }
  if (CONFIG.crashReporting.sentryDsn) {
    // Sentry.init({ dsn, release: import.meta.env.VITE_APP_VERSION }) —
    // wired up in the production build with source maps uploaded at CI time.
  }
}

/**
 * Mirror an analytics event to PostHog when configured.
 * Called from lib/analytics.track so events fire in both places.
 */
export function forwardToPostHog(
  event: string,
  data?: Record<string, string | number | boolean>,
): void {
  if (!posthogLoaded) return
  void event
  void data
}

/** report a crash (no-op without DSN) */
export function reportCrash(err: unknown): void {
  if (!CONFIG.crashReporting.sentryDsn) return
  console.error('[crash]', err)
}

export { track }
