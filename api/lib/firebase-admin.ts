/**
 * Firebase Admin SDK — SERVER ONLY.
 *
 * Used by backend functions that must bypass Firestore security rules
 * (provider writes: iccid/qrUrl/status/usage; order re-association).
 * Initialize from a service-account JSON in the env; when absent the
 * functions degrade gracefully (the client never depends on them).
 */
/** Minimal Firestore surface this module uses (avoids a hard type dependency
 *  on firebase-admin in the typecheck graph — the SDK is server-only and
 *  loaded dynamically at runtime). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any | null | undefined
let authHandle: any | null | undefined

/** Returns the Admin Firestore handle, or null when no service account is set. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function adminDb(): Promise<any | null> {
  if (db !== undefined) return db
  try {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT
    if (!raw) {
      db = null
      return db
    }
    const { cert, getApps, initializeApp } = await import('firebase-admin/app')
    const { getFirestore } = await import('firebase-admin/firestore')
    if (!getApps().length) initializeApp({ credential: cert(JSON.parse(raw)) })
    db = getFirestore()
    return db
  } catch {
    db = null
    return db
  }
}

/** Returns the Admin Auth handle, or null when no service account is set. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function adminAuth(): Promise<any | null> {
  if (authHandle !== undefined) return authHandle
  try {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT
    if (!raw) {
      authHandle = null
      return authHandle
    }
    const { cert, getApps, initializeApp } = await import('firebase-admin/app')
    const { getAuth } = await import('firebase-admin/auth')
    if (!getApps().length) initializeApp({ credential: cert(JSON.parse(raw)) })
    authHandle = getAuth()
    return authHandle
  } catch {
    authHandle = null
    return authHandle
  }
}
