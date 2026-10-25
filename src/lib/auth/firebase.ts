/**
 * Real Firebase backend — Firebase Auth (anonymous + email/password) and
 * Cloud Firestore, built on the shared `auth` / `db` handles from
 * config/firebase.ts (one app, initialized once).
 *
 * Admin/privileged writes never happen here: the client can only touch
 * users/{uid}/orders/{uid-owned docs} and the users-welcome outbox, all
 * enforced by /firestore.rules; provider fields (iccid, qrUrl, status,
 * usage) are written exclusively by backend functions via the Admin SDK.
 */
import {
  EmailAuthProvider,
  linkWithCredential,
  createUserWithEmailAndPassword,
  signInAnonymously,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  sendEmailVerification,
  sendPasswordResetEmail,
  onAuthStateChanged,
  type User,
} from 'firebase/auth'
import {
  collection,
  deleteDoc,
  doc as fsDoc,
  enableIndexedDbPersistence,
  getDocs,
  setDoc,
} from 'firebase/firestore'
import { auth, db } from '../../../config/firebase'
import { AuthError, type AuthAccount, type AuthBackend, type AuthErrorCode, type CloudOrderDoc } from './types'

/** Firebase auth error codes → stable AuthErrorCode for the UI. */
function mapCode(code: string): AuthErrorCode {
  switch (code) {
    case 'auth/email-already-in-use':
      return 'email-in-use'
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return 'wrong-password'
    case 'auth/user-not-found':
      return 'user-not-found'
    case 'auth/invalid-email':
      return 'invalid-email'
    case 'auth/weak-password':
      return 'weak-password'
    case 'auth/network-request-failed':
    case 'auth/internal-error': // fetch threw / no response (offline, blocked) — not a server fault
      return 'network'
    case 'auth/unauthorized-domain':
      return 'unauthorized-domain'
    case 'auth/invalid-api-key':
      return 'config-error'
    case 'auth/too-many-requests':
      return 'too-many-requests'
    case 'auth/requires-recent-login':
      return 'requires-recent-login'
    default:
      return 'unknown'
  }
}

/** Serialize a Firebase User → our provider-agnostic AuthAccount. */
function toAccount(user: User | null): AuthAccount | null {
  if (!user) return null
  const created = user.metadata?.creationTime ? Date.parse(user.metadata.creationTime) : Date.now()
  return {
    uid: user.uid,
    email: user.email ?? null,
    isAnonymous: Boolean(user.isAnonymous),
    emailVerified: Boolean(user.emailVerified),
    createdAt: Number.isNaN(created) ? Date.now() : created,
  }
}

export class FirebaseAuthBackend implements AuthBackend {
  readonly kind = 'firebase' as const
  private listeners = new Set<(a: AuthAccount | null) => void>()
  private ready = false
  private readyPromise: Promise<void> | null = null
  /**
   * The User handle from the most recent credential / auth-state event.
   * In the post-signup window `auth.currentUser` can LAG behind the
   * resolved credential (persistence hasn't caught up) — reading it there
   * threw 'No active session'. All follow-ups (verification email, profile
   * doc, refresh) must use THIS handle and never re-read auth.currentUser
   * in that window.
   */
  private activeUser: User | null = null


  /**
   * Wait (briefly) for the SDK to report a current user — on a cold start the
   * first auth-state event can lag behind the very first call, and reading
   * `auth.currentUser` in that window produced 'No active session'. Never
   * throws: resolves null if nobody shows up within the deadline.
   */
  private async resolveUser(deadlineMs = 3_000): Promise<User | null> {
    const started = Date.now()
    for (;;) {
      const u = this.activeUser ?? auth.currentUser
      if (u) return u
      if (Date.now() - started >= deadlineMs) return null
      await new Promise((r) => setTimeout(r, 100))
    }
  }

  private ensure(): Promise<void> {
    if (this.ready) return Promise.resolve()
    this.readyPromise ??= (async () => {
      // offline persistence — "My eSIMs" keeps working with no connection.
      // Best-effort: fails harmlessly with multiple tabs open.
      try {
        await enableIndexedDbPersistence(db)
      } catch {
        /* already enabled / unsupported */
      }
      onAuthStateChanged(auth, (user) => {
        this.activeUser = user
        const account = toAccount(user)
        for (const cb of this.listeners) cb(account)
      })
      this.ready = true
    })().catch((err) => {
      this.readyPromise = null
      throw err
    })
    return this.readyPromise
  }

  /**
   * 15s network timeout for signup/login — the SDK has no built-in timeout,
   * so a blocked request (ad/tracker blocking, captive portal, dead route)
   * spins the button forever. We poll the recorded network layer (installed
   * in config/firebase.ts): if the request failed fast (blocked), give up
   * immediately; if it's in flight, keep waiting; if nothing was recorded,
   * reject at the deadline.
   */
  private withNetTimeout<T>(p: Promise<T>, op: string): Promise<T> {
    const TIMEOUT_MS = 15_000
    const POLL_MS = 500
    const HOST = 'identitytoolkit.googleapis.com'
    let timer: ReturnType<typeof setTimeout> | undefined
    let interval: ReturnType<typeof setInterval> | undefined
    let timedOut = false
    let rejected = false

    const net = () =>
      (window as unknown as { __jumGoogleNet?: Record<string, { at: number; ok?: boolean; fail?: boolean }> })
        .__jumGoogleNet ?? {}

    const rejectOnce = (reject: (e: unknown) => void, e: AuthError, note: string) => {
      if (rejected) return
      rejected = true
      console.log(`[${op}] NETWORK_TIMEOUT — host: ${HOST} (${note})`)
      reject(e)
    }

    const timeout = new Promise<T>((_, reject) => {
      const deadline = Date.now() + TIMEOUT_MS
      interval = setInterval(() => {
        if (rejected) return
        const rec = net()[`https://${HOST}/v1/accounts:signUp`] ?? net()[`https://${HOST}/v1/accounts:signInWithPassword`]
        if (rec?.fail) {
          // Request fired and failed fast — blocked or unreachable. Don't wait 15s.
          rejectOnce(
            reject,
            new AuthError('network-timeout', `Request to ${HOST} was blocked or failed`),
            'request failed fast (blocked/unreachable)',
          )
          return
        }
        if (Date.now() > deadline) {
          timedOut = true
          if (rec && !rec.ok) {
            // In flight at the deadline but never completed.
            rejectOnce(
              reject,
              new AuthError('network-timeout', `Request to ${HOST} timed out`),
              'in flight but no response within 15s',
            )
          } else if (!rec) {
            // Never recorded — SDK bypassed the patch or never fired.
            rejectOnce(
              reject,
              new AuthError('network-timeout', `Request to ${HOST} timed out`),
              'no network activity recorded',
            )
          }
        }
      }, POLL_MS)
      timer = setTimeout(() => {
        if (!rejected) {
          timedOut = true
          rejectOnce(reject, new AuthError('network-timeout', `Request to ${HOST} timed out`), 'deadline reached')
        }
      }, TIMEOUT_MS + POLL_MS)
    })

    const guarded = p.catch((err: unknown) => {
      // The network error lost the race to the timeout — the caller has
      // already moved on (and the account may exist). Swallow so it can't
      // win a setError race against the timeout.
      if (timedOut && (err as AuthError)?.code === 'network') {
        console.log('[auth] late network error swallowed (timeout already surfaced)')
        return new Promise<never>(() => {}) // never settles — race already lost
      }
      throw err
    })

    return Promise.race([guarded, timeout]).finally(() => {
      clearTimeout(timer)
      clearInterval(interval)
    })
  }

  private wrap<T>(p: Promise<T>): Promise<T> {
    return p.catch((err: unknown) => {
      // Already one of our AuthErrors (timeout, mapped network) — rethrow as-is
      if (err instanceof AuthError) throw err
      // Log the ORIGINAL provider error in full BEFORE any mapping — never
      // collapse it silently to 'unknown'.
      const raw = String((err as { code?: string })?.code ?? '')
      console.log(
        '[auth] raw provider error:',
        JSON.stringify({
          code: raw || null,
          message: (err as Error)?.message ?? String(err),
          customData: (err as { customData?: unknown })?.customData ?? null,
        }),
      )
      const code = mapCode(raw)
      if (code === 'unknown') console.log('[auth] unmapped provider code (treated as unknown):', raw || '(no code on error object)')
      throw new AuthError(code, String((err as Error)?.message ?? err), raw || undefined)
    })
  }

  subscribe(cb: (account: AuthAccount | null) => void): () => void {
    this.listeners.add(cb)
    void this.ensure().then(() => cb(toAccount(auth.currentUser)))
    return () => {
      this.listeners.delete(cb)
    }
  }

  async init(): Promise<AuthAccount | null> {
    await this.ensure()
    if (auth.currentUser) return toAccount(auth.currentUser)!
    // First launch on this device → anonymous session, stable uid
    const cred = await this.wrap(signInAnonymously(auth))
    this.activeUser = cred.user
    return toAccount(cred.user)!
  }

  async signUpWithEmail(email: string, password: string): Promise<AuthAccount> {
    await this.ensure()
    const current = this.activeUser ?? auth.currentUser
    if (current?.isAnonymous) {
      // linkWithCredential: the anonymous uid (and its orders) survives
      const credential = EmailAuthProvider.credential(email, password)
      try {
        const cred = await this.wrap(this.withNetTimeout(linkWithCredential(current, credential), 'auth/signup'))
        this.activeUser = cred.user
        return toAccount(cred.user)!
      } catch (err) {
        const rawCode = (err as { rawCode?: string; code?: string })?.rawCode ?? (err as { code?: string })?.code
        console.log('[auth/signup] linkWithCredential FAILED, code =', rawCode, '| message =', (err as Error)?.message)
        if (rawCode === 'auth/credential-already-in-use') {
          // The email+password already belongs to an account — sign in to it.
          // Silent fallback: the user ends up signed in to the right account.
          console.log('[auth/signup] credential already in use — falling back to signInWithEmailAndPassword')
          const cred = await this.wrap(
            this.withNetTimeout(signInWithEmailAndPassword(auth, email, password), 'auth/signup'),
          )
          this.activeUser = cred.user
          return toAccount(cred.user)!
        }
        // Any other link error: linking is OPTIONAL, signup is not — log and
        // continue with a fresh createUserWithEmailAndPassword attempt.
        console.log('[auth/signup] link error is non-fatal — continuing with createUserWithEmailAndPassword')
      }
    }
    try {
        const cred = await this.wrap(
        this.withNetTimeout(createUserWithEmailAndPassword(auth, email, password), 'auth/signup'),
      )
      this.activeUser = cred.user
      return toAccount(cred.user)!
    } catch (err) {
      console.log('[auth/signup] createUserWithEmailAndPassword FAILED, code =', (err as { rawCode?: string; code?: string })?.rawCode ?? (err as { code?: string })?.code, '| message =', (err as Error)?.message)
      throw err
    }
  }

  async signInWithEmail(email: string, password: string): Promise<AuthAccount> {
    await this.ensure()
    const cred = await this.wrap(
      this.withNetTimeout(signInWithEmailAndPassword(auth, email, password), 'auth/login'),
    )
    this.activeUser = cred.user
    return toAccount(cred.user)!
  }

  /** Current signed-in uid (null when anonymous or signed out). */
  currentUid(): string | null {
    const u = this.activeUser ?? auth.currentUser
    return u && !u.isAnonymous ? u.uid : null
  }

  /** Built-in verification email — Firebase's "Email address verification"
   *  template (customize sender/subject/body in the console). */
  async sendVerificationEmail(): Promise<void> {
    await this.ensure()
    // Use the credential's User handle — NEVER a bare auth.currentUser read
    // in the post-signup window (persistence may not have caught up; that
    // race surfaced as 'No active session'). resolveUser also tolerates a
    // cold start where no auth-state event has fired yet.
    const user = await this.resolveUser()
    if (!user) throw new AuthError('unknown', 'No active session')
    // Real Firebase sendEmailVerification — the built-in "Email address
    // verification" template. Action URL stays the Firebase default
    // (…/__/auth/action); the template lives in the console.
    await this.wrap(sendEmailVerification(user, { url: 'https://jum-esim.firebaseapp.com' }))
  }

  /** Refresh emailVerified from the server (user may have clicked the link). */
  async refreshAccount(): Promise<AuthAccount | null> {
    await this.ensure()
    const user = await this.resolveUser()
    if (!user) return null
    // reload() pulls fresh user data; getIdToken(true) forces a token refresh
    // so the cached ID token's emailVerified claim is also current — without
    // it, the stale claim can keep the app thinking the user is unverified
    // even after they clicked the link.
    await this.wrap(user.reload())
    try {
      await user.getIdToken(true)
    } catch {
      /* best-effort — reload() already gave us the authoritative flag */
    }
    return toAccount(user)
  }

  async sendPasswordReset(email: string): Promise<void> {
    await this.ensure()
    await this.wrap(sendPasswordResetEmail(auth, email))
  }

  async signOut(): Promise<void> {
    await this.wrap(fbSignOut(auth))
    this.activeUser = null
  }

  async deleteAccount(uid: string): Promise<void> {
    await this.removeUserDocs(uid)
    const user = await this.resolveUser()
    if (user && user.uid === uid) await this.wrap(user.delete())
    this.activeUser = null
  }

  async putOrder(uid: string, doc: CloudOrderDoc): Promise<void> {
    await this.ensure()
    await this.wrap(setDoc(fsDoc(db, 'users', uid, 'orders', doc.orderId), { ...doc, uid }))
  }

  async listOrders(uid: string): Promise<CloudOrderDoc[]> {
    await this.ensure()
    const snap = await this.wrap(getDocs(collection(db, 'users', uid, 'orders')))
    return snap.docs.map((d) => d.data() as CloudOrderDoc)
  }

  async removeUserDocs(uid: string): Promise<void> {
    await this.ensure()
    const snap = await this.wrap(getDocs(collection(db, 'users', uid, 'orders')))
    await Promise.all(snap.docs.map((d) => this.wrap(deleteDoc(d.ref))))
  }

  /**
   * Best-effort users/{uid} profile doc written AFTER signup (email, createdAt).
   * MUST NOT throw: once userCredential.user.uid exists signup has SUCCEEDED —
   * a failed profile write is logged and swallowed, never surfaced as a
   * signup error, never rolled back.
   */
  async putUserProfile(uid: string, profile: { email: string; createdAt: number }): Promise<{ ok: boolean }> {
    await this.ensure()
    try {
      await setDoc(fsDoc(db, 'users', uid), { ...profile, uid }, { merge: true })
      return { ok: true }
    } catch (err) {
      console.log('[profile] Firestore write FAILED: users/' + uid, '| code =', (err as { code?: string })?.code, '| message =', (err as Error)?.message)
      return { ok: false }
    }
  }

  /**
   * Trigger Email extension outbox (firestore-send-email): a doc in
   * `users-welcome` with { to, template } is picked up by the extension and
   * mailed via SendGrid. Failures NEVER throw to the caller — the signup
   * flow must never block on email. Returns false when the write failed.
   */
  async sendMailDoc(docId: string, payload: Record<string, unknown>): Promise<boolean> {
    await this.ensure()
    try {
      await setDoc(fsDoc(db, 'users-welcome', docId), payload)
      return true
    } catch (err) {
      // 'failed-precondition' here usually means the Firestore database
      // hasn't been created in this project yet (console checklist step 2).
      console.log('[mail] Firestore write FAILED: users-welcome/' + docId, '| code =', (err as { code?: string })?.code, '| message =', (err as Error)?.message)
      return false
    }
  }

  /**
   * Email-match restore runs SERVER-side: the client can't scan other
   * users' orders (rules forbid it). Backend function uses the Admin SDK
   * (bypasses rules), finds orders whose delivery email matches and have
   * no uid, and re-associates them. 404/501 → "nothing restored", never a
   * crash.
   */
  async reassociateByEmail(email: string, uid: string): Promise<number> {
    try {
      const apiUrl = (import.meta.env.VITE_API_URL as string | undefined) ?? ''
      const res = await fetch(`${apiUrl}/api/auth/reassociate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, uid }),
      })
      if (!res.ok) return 0
      const body = (await res.json()) as { moved?: number }
      return body.moved ?? 0
    } catch {
      return 0
    }
  }
}
