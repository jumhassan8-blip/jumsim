/**
 * AuthContext — the signed-in session plus the orders sync engine.
 *
 * Session lifecycle:
 *  - launch: backend restores a persisted session; first launch ever signs
 *    in ANONYMOUSLY so every device owns a stable uid from the first purchase
 *  - sign-up from an anonymous session LINKS the account (same uid — orders
 *    follow the user automatically, zero migration UI)
 *  - sign-out keeps the local cache; the app keeps working fully
 *  - orders dual-write: every purchase writes local cache AND the cloud doc
 *    users/{uid}/orders/{orderId}; on login the cloud is source of truth and
 *    the local cache re-populates from it (new device / reinstall)
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { AuthError, authBackend, type AuthAccount, type AuthSession } from '../lib/auth'
import { loadPurchases, savePurchases } from '../lib/storage'
import { track } from '../lib/analytics'
import { CONFIG } from '../config'
import type { Purchase } from '../types'

/** Resend throttling: 60 s cooldown between sends, max 3 per rolling hour. */
const VERIFY_COOLDOWN_MS = 60_000
const VERIFY_MAX_PER_HOUR = 3
const VERIFY_LOG_KEY = 'jum-esim:verify-sends:v1'

function verifySends(): number[] {
  try {
    const raw = localStorage.getItem(VERIFY_LOG_KEY)
    return raw ? (JSON.parse(raw) as number[]) : []
  } catch {
    return []
  }
}

export type ResendStatus = 'sent' | 'cooldown' | 'capped' | 'error'
export interface VerifySendError {
  code: string
  message: string
}

interface AuthValue {
  session: AuthSession
  /** true while an auth request (sign-in/up/out/delete) is in flight */
  busy: boolean
  /** human-mapped error code from the last failed request, null otherwise */
  error: string | null
  clearError: () => void
  signUp: (email: string, password: string) => Promise<boolean>
  signIn: (email: string, password: string) => Promise<boolean>
  resetPassword: (email: string) => Promise<void>
  signOut: () => Promise<void>
  deleteAccount: () => Promise<void>
  /**
   * Backup restore path: re-associates cloud orders whose delivery email
   * matches the account (and had no uid), then pulls the cloud set into the
   * local cache. Returns how many orders were restored.
   */
  restorePurchases: () => Promise<number>
  /**
   * True for a signed-in email account whose address isn't verified yet —
   * sensitive actions (refund requests) are gated on this.
   */
  needsVerification: boolean
  /** epoch ms when the resend cooldown ends; null = resend available now */
  verifyCooldownUntil: number | null
  /** Resend the verification email, throttled (cooldown / hourly cap). */
  resendVerification: () => Promise<ResendStatus>
  /** Re-read emailVerified from the server (user may have clicked the link). */
  refreshVerification: () => Promise<void>
  /** TEMP DEBUG — raw provider error from the last failed signup, verbatim */
  debugAuthError: string | null
  /** Last sendEmailVerification failure (raw provider code + message), if any. */
  verifySendError: VerifySendError | null
}

const AuthCtx = createContext<AuthValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<AuthAccount | null>(null)
  const [ready, setReady] = useState(false)
  const [syncedAt, setSyncedAt] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [verifyCooldownUntil, setVerifyCooldownUntil] = useState<number | null>(null)
  const accountRef = useRef<AuthAccount | null>(null)
  accountRef.current = account

  // Dedupe the initial verification send: a double-tap on "Create account"
  // must never fire sendEmailVerification twice (one signup = one email).
  const verifySendInFlight = useRef(false)

  // Re-check email verification when the app returns to the foreground —
  // the user may have just clicked the verification link in another tab
  // (or their mail app) while this one was backgrounded.
  const refreshVerification = useCallback(async () => {
    try {
      const a = await authBackend.refreshAccount()
      if (a) setAccount(a)
    } catch {
      /* offline — the next resync/launch picks it up */
    }
  }, [])

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible' && accountRef.current && !accountRef.current.isAnonymous) {
        void refreshVerification()
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [refreshVerification])

  // launch: restore persisted session (or mint the first anonymous one)
  useEffect(() => {
    let cancelled = false
    authBackend
      .init()
      .then((a) => {
        if (cancelled) return
        if (a) setAccount(a)
        setReady(true)
      })
      .catch(() => {
        if (!cancelled) setReady(true) // guest mode never blocks on auth
      })
    const unsub = authBackend.subscribe((a) => {
      if (!cancelled) setAccount(a)
    })
    return () => {
      cancelled = true
      unsub()
    }
  }, [])

  /** Merge cloud orders into the local cache; cloud wins on conflict. */
  const mergeCloudIntoCache = useCallback((docs: { orderId: string; purchase: unknown }[]) => {
    if (docs.length === 0) return 0
    const valid = docs.filter(
      (d): d is { orderId: string; purchase: Purchase } =>
        Boolean(d.purchase && (d.purchase as Purchase).order?.id),
    )
    if (valid.length === 0) return 0
    const byId = new Map(loadPurchases().map((p) => [p.order.id, p]))
    for (const d of valid) byId.set(d.orderId, d.purchase)
    savePurchases([...byId.values()])
    return valid.length
  }, [])

  /**
   * Full resync for the signed-in uid: pull the cloud set (source of truth),
   * merge into the local cache, then push any local-only orders up.
   * Runs on every account change with an email (sign-in, link, launch).
   */
  const resync = useCallback(async (a: AuthAccount) => {
    try {
      const docs = await authBackend.listOrders(a.uid)
      mergeCloudIntoCache(docs)
      const cloudIds = new Set(docs.map((d) => d.orderId))
      const localOnly = loadPurchases().filter((p) => !cloudIds.has(p.order.id))
      await Promise.all(
        localOnly.map((p) =>
          authBackend
            .putOrder(a.uid, {
              orderId: p.order.id,
              uid: a.uid,
              email: p.order.email,
              purchase: p,
              updatedAt: Date.now(),
            })
            .catch(() => {}),
        ),
      )
      setSyncedAt(Date.now())
    } catch (err) {
      // TEMP DEBUG (4) — cloud read result after login/signup, separate from
      // the Auth result. failed-precondition ⇒ Firestore DB not created.
      console.log('[sync] cloud orders read FAILED | code =', (err as { code?: string })?.code, '| message =', (err as Error)?.message)
      /* offline — local cache carries the app; next login resyncs */
    }
  }, [mergeCloudIntoCache])

  // resync whenever the signed-in (email) account changes
  const lastSyncUid = useRef<string | null>(null)
  useEffect(() => {
    if (!ready || !account || account.isAnonymous) return
    if (lastSyncUid.current === account.uid) return
    lastSyncUid.current = account.uid
    void resync(account)
  }, [ready, account, resync])

  const run = useCallback(
    async (fn: () => Promise<AuthAccount | void>): Promise<boolean> => {
      if (busy) return false
      setBusy(true)
      setError(null)
      try {
        const before = accountRef.current
        const result = await fn()
        // anonymous → email on the SAME uid = the link just happened
        if (
          result &&
          before?.isAnonymous &&
          !result.isAnonymous &&
          result.uid === before.uid
        ) {
          track('account_linked_anonymous', { uid: result.uid })
        }
        return true
      } catch (err) {
        if (err instanceof AuthError) {
          setError(err.code)
        } else {
          setError('unknown')
        }
        return false
      } finally {
        setBusy(false)
      }
    },
    [busy],
  )

  // TEMP DEBUG — last raw auth failure surfaced verbatim (see Auth banner)
  const [debugAuthError, setDebugAuthError] = useState<string | null>(null)
  // Last sendEmailVerification failure surfaced in the verify-email card
  const [verifySendError, setVerifySendError] = useState<VerifySendError | null>(null)

  /**
   * Welcome + owner-alert emails ride the Trigger Email extension outbox
   * (firestore-send-email → SendGrid). Part 3 guarantees: email failures
   * NEVER block signup — retry once, then log + track and move on.
   */
  const queueWelcomeEmails = useCallback((a: AuthAccount) => {
    if (!a.email) return
    const welcomeDoc = {
      to: a.email,
      template: { name: 'welcome', data: { email: a.email } },
    }
    const ownerDoc = {
      to: CONFIG.supportEmail,
      subject: `New signup: ${a.email}`,
      text: `New signup: ${a.email} at ${new Date().toISOString()}`,
    }
    const sendWithRetry = async (docId: string, payload: Record<string, unknown>) => {
      let ok = await authBackend.sendMailDoc(docId, payload)
      if (!ok) {
        await new Promise((r) => setTimeout(r, 2000)) // retry once
        ok = await authBackend.sendMailDoc(docId, payload)
      }
      if (!ok) track('welcome_email_failed', { docId })
    }
    void sendWithRetry(`welcome-${a.uid}`, welcomeDoc)
    void sendWithRetry(`owner-${a.uid}`, ownerDoc)
  }, [])

  /** Built-in verification email (Firebase template). */
  const sendVerification = useCallback(async (trackResend: boolean): Promise<ResendStatus> => {
    const now = Date.now()
    const sends = verifySends()
    if (verifySendInFlight.current) return 'cooldown' // send already in flight — dedupe
    if (now < verifyCooldownUntil!) return 'cooldown'
    const last = sends[sends.length - 1] ?? 0
    if (now - last < VERIFY_COOLDOWN_MS) return 'cooldown'
    if (sends.filter((t) => now - t < 3_600_000).length >= VERIFY_MAX_PER_HOUR) return 'capped'
    verifySendInFlight.current = true
    try {
      await authBackend.sendVerificationEmail()
    } catch (err) {
      // Never fail silently — surface the raw provider error in the verify card.
      const code = err instanceof AuthError ? (err.rawCode ?? err.code) : 'unknown'
      setVerifySendError({ code, message: (err as Error)?.message ?? String(err) })
      return 'error'
    } finally {
      verifySendInFlight.current = false
    }
    setVerifySendError(null)
    try {
      localStorage.setItem(VERIFY_LOG_KEY, JSON.stringify([...sends, now].slice(-20)))
    } catch {
      /* non-fatal */
    }
    setVerifyCooldownUntil(now + VERIFY_COOLDOWN_MS)
    if (trackResend) track('auth_verification_resent', {})
    return 'sent'
  }, [verifyCooldownUntil])

  const sendVerificationInitial = useCallback(async () => {
    await sendVerification(false)
  }, [sendVerification])

  const resendVerification = useCallback(async (): Promise<ResendStatus> => {
    setBusy(true)
    try {
      return await sendVerification(true)
    } finally {
      setBusy(false)
    }
  }, [sendVerification])

  const signUp = useCallback(
    (email: string, password: string) =>
      run(async () => {
        let a: AuthAccount
        try {
          a = await authBackend.signUpWithEmail(email, password)
        } catch (err) {
          // Surface the real provider error, never swallow it.
          const raw = err instanceof AuthError ? err.rawCode : undefined
          console.log('[auth/signup] code =', raw ?? (err as { code?: string })?.code, '| message =', (err as Error)?.message)
          setDebugAuthError(
            raw
              ? `${raw} — ${(err as Error)?.message}`
              : (err as { code?: string })?.code === 'network-timeout'
                ? null // mapped codes render their own specific banner text
                : `${(err as { code?: string })?.code ?? 'unknown'} — ${(err as Error)?.message ?? String(err)}`,
          )
          throw err
        }
        setDebugAuthError(null)
        setAccount(a)
        track('auth_signup_completed', { uid: a.uid })
        // Post-signup follow-ups — ALL non-blocking. Once a.uid exists the
        // signup has SUCCEEDED: any failure here (verification email, profile
        // doc, welcome emails) is logged and surfaced as resend state, never
        // as the red error banner, never as a rollback/sign-out.
        void (async () => {
          try {
            await sendVerificationInitial()
            await authBackend.putUserProfile(a.uid, {
              email: a.email ?? email,
              createdAt: a.createdAt,
            })
          } catch (err) {
            console.warn('[auth/signup] follow-up failed (non-fatal):', err)
          }
        })()
        queueWelcomeEmails(a)
        return a
      }),
    [run, queueWelcomeEmails, sendVerificationInitial],
  )

  const signIn = useCallback(
    (email: string, password: string) =>
      run(async () => {
        const a = await authBackend.signInWithEmail(email, password)
        setAccount(a)
        track('auth_login_completed', { uid: a.uid })
        return a
      }),
    [run],
  )

  const resetPassword = useCallback(async (email: string) => {
    setBusy(true)
    setError(null)
    try {
      await authBackend.sendPasswordReset(email)
      track('auth_reset_requested', {})
    } catch (err) {
      setError(err instanceof AuthError ? err.code : 'unknown')
    } finally {
      setBusy(false)
    }
  }, [])

  const signOut = useCallback(async () => {
    setBusy(true)
    try {
      await authBackend.signOut()
      setAccount(null)
      lastSyncUid.current = null
    } finally {
      setBusy(false)
    }
  }, [])

  const deleteAccount = useCallback(async () => {
    const a = accountRef.current
    if (!a || a.isAnonymous) return
    setBusy(true)
    setError(null)
    try {
      await authBackend.deleteAccount(a.uid) // cloud docs + auth user
      savePurchases([]) // local cache cleared — irreversible, warned in UI
      setAccount(null)
      lastSyncUid.current = null
      track('account_deleted', {})
    } finally {
      setBusy(false)
    }
  }, [])

  const restorePurchases = useCallback(async (): Promise<number> => {
    const a = accountRef.current
    if (!a || a.isAnonymous || !a.email) return 0
    setBusy(true)
    try {
      await authBackend.reassociateByEmail(a.email, a.uid)
      const docs = await authBackend.listOrders(a.uid)
      const restored = mergeCloudIntoCache(docs)
      setSyncedAt(Date.now())
      if (restored > 0) track('orders_restored', { count: restored })
      return restored
    } catch {
      return 0
    } finally {
      setBusy(false)
    }
  }, [mergeCloudIntoCache])

  const needsVerification = Boolean(account && !account.isAnonymous && !account.emailVerified)

  const value = useMemo<AuthValue>(
    () => ({
      session: { account, ready, syncedAt, backend: authBackend.kind },
      busy,
      error,
      clearError: () => setError(null),
      signUp,
      signIn,
      resetPassword,
      signOut,
      deleteAccount,
      restorePurchases,
      needsVerification,
      verifyCooldownUntil,
      resendVerification,
      refreshVerification,
      debugAuthError,
      verifySendError,
    }),
    [account, ready, syncedAt, busy, error, signUp, signIn, resetPassword, signOut, deleteAccount, restorePurchases, needsVerification, verifyCooldownUntil, resendVerification, refreshVerification, debugAuthError, verifySendError],
  )

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthCtx)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
