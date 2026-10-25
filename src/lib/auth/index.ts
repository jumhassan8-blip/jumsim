/**
 * Auth backend — real Firebase only. Production is fail-closed: when the
 * Firebase config is incomplete, `firebaseEnabled` is false and the app
 * renders the unavailable screen (src/App.tsx) instead of running any
 * auth. There is no fallback backend.
 */
import { FirebaseAuthBackend } from './firebase'
import type { AuthBackend } from './types'

export const authBackend: AuthBackend = new FirebaseAuthBackend()

export { AuthError } from './types'
export type { AuthAccount, AuthErrorCode, AuthSession, CloudOrderDoc } from './types'
