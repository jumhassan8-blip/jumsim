/**
 * Firebase client config — PUBLIC values only, safe to ship in the bundle.
 *
 * These identify the Firebase project (like a Stripe publishable key); they
 * are NOT secrets. Security comes from Firestore rules (firestore.rules),
 * the Authorized-domains list in the Firebase console, and keeping all
 * privileged writes in server functions (Admin SDK — server env only).
 *
 * Values come from YOUR EXISTING project: Firebase Console → Project
 * settings (gear) → General → "Your apps" → select the web app → copy the
 * firebaseConfig object → paste into .env (see .env.example). The
 * EXPO_PUBLIC_* names below work for both the native (Expo) and web builds;
 * the web build also accepts VITE_* aliases.
 *
 * This module initializes the app ONCE and exports the shared `auth` /
 * `db` handles — every consumer imports these, never initializeApp again.
 *
 * Production is FAIL-CLOSED: if the six public config values are missing,
 * `firebaseEnabled` is false and the app renders a single "Service
 * temporarily unavailable" screen (see src/App.tsx) — it never runs a
 * stand-in auth.
 */
import { initializeApp, type FirebaseApp } from 'firebase/app'
import { getAuth, type Auth } from 'firebase/auth'
import { getFirestore, type Firestore } from 'firebase/firestore'

/** Read EXPO_PUBLIC_* first (spec/native build), then VITE_* (web build). */
const env = (name: string): string => {
  const im = import.meta.env as Record<string, string | undefined>
  return im[`EXPO_PUBLIC_${name}`] ?? im[`VITE_${name}`] ?? ''
}

const firebaseConfig = {
  apiKey:            env('FIREBASE_API_KEY'),
  authDomain:        env('FIREBASE_AUTH_DOMAIN'),
  projectId:         env('FIREBASE_PROJECT_ID'),
  storageBucket:     env('FIREBASE_STORAGE_BUCKET'),
  messagingSenderId: env('FIREBASE_MESSAGING_SENDER_ID'),
  appId:             env('FIREBASE_APP_ID'),
}

/** Public project identity (not a secret) — exported for diagnostics. */
export { firebaseConfig }

/** True only when every required public config value is present. */
export const firebaseEnabled: boolean = Boolean(
  firebaseConfig.apiKey &&
    firebaseConfig.authDomain &&
    firebaseConfig.projectId &&
    firebaseConfig.storageBucket &&
    firebaseConfig.messagingSenderId &&
    firebaseConfig.appId,
)

// Network-layer visibility for the auth timeout wrapper. The Firebase SDK
// resolves `self.fetch` directly (bypassing window.fetch) and may fall back
// to XHR — so patch BOTH entry points. Records per-URL outcomes so the
// timeout wrapper can distinguish "blocked quickly" (give up now) from
// "slow but active" (keep waiting).
{
  interface NetRecord {
    at: number
    ok?: boolean
    fail?: boolean
  }
  const g = window as unknown as { __jumGoogleNet?: Record<string, NetRecord> }
  g.__jumGoogleNet = {}
  const isGoogleApi = (u: string) => u.includes('googleapis.com') || u.includes('firebase')
  const rec = (u: string) => (isGoogleApi(u) ? ((g.__jumGoogleNet ??= {})[u] ??= { at: Date.now() }) : null)

  const of = window.fetch?.bind(window)
  if (of) {
    window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      let u = ''
      try {
        u = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      } catch {
        /* non-fatal */
      }
      const r = rec(u)
      const p = of(input, init)
      if (r) {
        p.then(
          () => {
            r.ok = true
          },
          () => {
            r.fail = true
          },
        )
      }
      return p
    }) as typeof fetch
  }

  const X = window.XMLHttpRequest
  if (X) {
    const P = X.prototype
    const oo = P.open
    P.open = function (this: XMLHttpRequest, m: string, u: string | URL, ...rest: unknown[]) {
      const r = rec(String(u))
      if (r) {
        this.addEventListener('load', () => {
          r.ok = true
        })
        this.addEventListener('error', () => {
          r.fail = true
        })
        this.addEventListener('abort', () => {
          r.fail = true
        })
      }
      return (oo as (...a: unknown[]) => void).apply(this, [m, u, ...rest])
    }
  }
}

// Guarded: initializeApp/getAuth throw on an empty config (invalid-api-key
// at module load). When firebaseEnabled is false these stay null-typed and
// the app renders the unavailable screen instead of touching them.
const app: FirebaseApp = firebaseEnabled
  ? initializeApp(firebaseConfig)
  : (null as unknown as FirebaseApp)
export const auth: Auth = firebaseEnabled ? getAuth(app) : (null as unknown as Auth)
export const db: Firestore = firebaseEnabled ? getFirestore(app) : (null as unknown as Firestore)

export const authConfig = {
  /**
   * Phase 2 — Google + Apple sign-in buttons. Disabled by default; flip to
   * true only after the providers are configured in the Firebase console
   * AND the native builds have their SDKs wired. While false the buttons
   * don't render at all.
   */
  socialEnabled: env('AUTH_SOCIAL_ENABLED') === '1',
} as const
