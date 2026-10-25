/**
 * Auth + cloud-sync primitives for the real Firebase backend. The client
 * only ever talks to this interface.
 */

export interface AuthAccount {
  uid: string
  email: string | null
  isAnonymous: boolean
  /** Firebase email verification — required before refund requests */
  emailVerified: boolean
  /** epoch ms — "Member since" in the account sheet */
  createdAt: number
}

export interface AuthSession {
  /** null = signed out; anonymous sessions still have an account */
  account: AuthAccount | null
  /** true once the persisted session (if any) has been restored at launch */
  ready: boolean
  /** epoch ms of the last successful cloud orders sync, null = never */
  syncedAt: number | null
  /** which provider backs the session — surfaced in diagnostics */
  backend: 'firebase'
}

/** Stable error codes → mapped to inline i18n messages by the UI. */
export type AuthErrorCode =
  | 'email-in-use'
  | 'wrong-password'
  | 'user-not-found'
  | 'invalid-email'
  | 'weak-password'
  | 'network'
  | 'network-timeout'
  | 'unauthorized-domain'
  | 'config-error'
  | 'too-many-requests'
  | 'requires-recent-login'
  | 'unknown'

export class AuthError extends Error {
  readonly code: AuthErrorCode
  /** TEMP DEBUG — the original provider code (e.g. auth/invalid-api-key) */
  readonly rawCode?: string
  constructor(code: AuthErrorCode, message?: string, rawCode?: string) {
    super(message ?? code)
    this.name = 'AuthError'
    this.code = code
    this.rawCode = rawCode
  }
}

/** What one order looks like as a cloud document (users/{uid}/orders/{orderId}). */
export interface CloudOrderDoc {
  orderId: string
  uid: string
  /** delivery email captured at checkout — powers the email-match restore path */
  email: string
  /** the full local Purchase payload, mirrored */
  purchase: unknown
  updatedAt: number
}

export interface AuthBackend {
  readonly kind: 'firebase'

  /** Restore persisted session; on a device's first launch sign in ANONYMOUSLY
   *  so every device owns a stable uid from the very first purchase. */
  init(): Promise<AuthAccount | null>

  /**
   * Email + password sign-up. If the current session is anonymous, the
   * account is LINKED (the anon uid keeps its orders — zero migration UI);
   * otherwise a fresh account is created.
   */
  signUpWithEmail(email: string, password: string): Promise<AuthAccount>

  /** Email + password login. */
  signInWithEmail(email: string, password: string): Promise<AuthAccount>

  /** Password-reset email; the UI shows its own confirmation state. */
  sendPasswordReset(email: string): Promise<void>

  /** Built-in email-verification message (Firebase template). */
  sendVerificationEmail(): Promise<void>
  /** Re-read the account from the server (user may have clicked the link). */
  refreshAccount(): Promise<AuthAccount | null>

  /**
   * Trigger Email extension outbox: write { to, template } to the
   * `users-welcome` collection. MUST NOT throw — email must never block
   * signup. Returns false when the write failed (caller retries/logs).
   */
  sendMailDoc(docId: string, payload: Record<string, unknown>): Promise<boolean>

  /**
   * Best-effort users/{uid} profile doc written after signup. MUST NOT throw —
   * signup has already succeeded at this point; a failed write is logged and
   * returned with the ORIGINAL error object preserved, never surfaced as an
   * error, never rolled back.
   */
  putUserProfile(
    uid: string,
    profile: { email: string; createdAt: number },
  ): Promise<{ ok: boolean; error?: unknown }>

  /**
   * TEMP DEBUG (signup trace step 7) — the uid the underlying SDK currently
   * reports for the session (Firebase: auth.currentUser; local: sessionUid).
   */
  currentUid(): string | null

  signOut(): Promise<void>

  /**
   * Delete the Auth user AND every cloud document under users/{uid}.
   * The caller clears the local cache afterwards.
   */
  deleteAccount(uid: string): Promise<void>

  subscribe(cb: (account: AuthAccount | null) => void): () => void

  // ── cloud document store (Firestore-shaped) ──────────────────────────
  putOrder(uid: string, doc: CloudOrderDoc): Promise<void>
  listOrders(uid: string): Promise<CloudOrderDoc[]>
  removeUserDocs(uid: string): Promise<void>
  /**
   * Backup restore path: server re-associates orders whose delivery email
   * matches the account but which were never stamped with a uid.
   * Returns the number of orders re-associated.
   */
  reassociateByEmail(email: string, uid: string): Promise<number>
}
