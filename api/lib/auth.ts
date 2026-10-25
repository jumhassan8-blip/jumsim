/**
 * Auth gate for provider-touching API routes (security brief §3).
 *
 * Two accepted credentials — Firebase-auth OR server-to-server:
 *
 *   1. Firebase ID token — `Authorization: Bearer <idToken>`.
 *      Verified against Google's public certs with zero external deps
 *      (RS256 via node:crypto, cert cache honouring Cache-Control).
 *      Active only when a Firebase project id is configured
 *      (FIREBASE_PROJECT_ID / EXPO_PUBLIC_FIREBASE_PROJECT_ID); with no
 *      project configured this path simply does not authenticate.
 *   2. Server-to-server token — `Authorization: Bearer <token>` or
 *      `x-server-token: <token>` equal to PROVIDER_SETUP_TOKEN, the same
 *      deploy/CI token api/providers/setup.ts uses.
 *
 * Anything else → the caller route responds 401 itself. This module never
 * logs tokens; audit fields record only the auth KIND and uid.
 */
import { createVerify } from 'node:crypto'
import type { IncomingMessage } from 'node:http'

const CERTS_URL =
  'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com'

let certCache: { pem: Record<string, string>; expiry: number } | null = null

async function googleCerts(): Promise<Record<string, string>> {
  if (certCache && certCache.expiry > Date.now() + 60_000) return certCache.pem
  const res = await fetch(CERTS_URL)
  if (!res.ok) throw new Error(`certs_fetch_${res.status}`)
  const maxAge = Number(res.headers.get('cache-control')?.match(/max-age=(\d+)/)?.[1] ?? 3600)
  certCache = { pem: (await res.json()) as Record<string, string>, expiry: Date.now() + maxAge * 1000 }
  return certCache.pem
}

function projectId(): string {
  return (process.env.FIREBASE_PROJECT_ID ?? process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ?? '').trim()
}

function decodeJson(segment: string): Record<string, unknown> | null {
  try {
    return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as Record<string, unknown>
  } catch {
    return null
  }
}

export async function verifyFirebaseIdToken(idToken: string): Promise<{ uid: string } | null> {
  const project = projectId()
  if (!project) return null
  const parts = idToken.split('.')
  if (parts.length !== 3) return null
  const header = decodeJson(parts[0])
  const payload = decodeJson(parts[1])
  if (!header || !payload) return null
  const now = Math.floor(Date.now() / 1000)
  if (payload.aud !== project) return null
  if (payload.iss !== `https://securetoken.google.com/${project}`) return null
  if (typeof payload.exp !== 'number' || payload.exp < now) return null
  if (typeof payload.iat !== 'number' || payload.iat > now + 300) return null
  const kid = typeof header.kid === 'string' ? header.kid : null
  if (!kid) return null
  const certs = await googleCerts().catch(() => null)
  const pem = certs?.[kid]
  if (!pem) return null
  try {
    const valid = createVerify('RSA-SHA256')
      .update(`${parts[0]}.${parts[1]}`)
      .verify(pem, parts[2], 'base64url')
    return valid && typeof payload.sub === 'string' ? { uid: payload.sub } : null
  } catch {
    return null
  }
}

export type AuthContext = { kind: 'firebase'; uid: string } | { kind: 'server' }

/**
 * Authenticate a request. Returns null when unauthenticated — the route
 * must then answer 401; this helper never sends the response itself so the
 * route keeps full control of its error contract.
 */
export async function authenticate(req: IncomingMessage): Promise<AuthContext | null> {
  const serverToken = process.env.PROVIDER_SETUP_TOKEN
  const auth = req.headers.authorization ?? ''
  if (auth.startsWith('Bearer ')) {
    const token = auth.slice(7).trim()
    if (serverToken && token === serverToken) return { kind: 'server' }
    const fb = await verifyFirebaseIdToken(token)
    if (fb) return { kind: 'firebase', uid: fb.uid }
    return null
  }
  const header = req.headers['x-server-token']
  if (typeof header === 'string' && serverToken && header === serverToken) {
    return { kind: 'server' }
  }
  return null
}
