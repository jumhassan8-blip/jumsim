/**
 * Shared helpers for the top-up routes: auth-context extraction, IP
 * resolution, and the per-IP fraud window (brief §6). Auth accepts EITHER
 * a Firebase ID token OR the server-to-server PROVIDER_SETUP_TOKEN — the
 * same dual scheme api/lib/auth.ts provides for confirm-order. When no
 * auth infra is configured at all, requests run guest (uid null) so the
 * waitlist state is reachable before Firebase setup.
 */
import type { IncomingMessage } from 'node:http'
import { authenticate } from '../lib/auth'

export interface TopUpCtx {
  uid: string | null
  ip: string
  authKind: 'firebase' | 'server' | 'guest'
}

export async function topUpCtx(req: IncomingMessage): Promise<TopUpCtx> {
  const ip =
    (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ??
    req.socket.remoteAddress ??
    'unknown'
  const auth = await authenticate(req).catch(() => null)
  if (!auth) return { uid: null, ip, authKind: 'guest' }
  return { uid: auth.kind === 'firebase' ? auth.uid : null, ip, authKind: auth.kind }
}

/** Resolve the provider name the UI should display for diagnostics. */
export function providerConfigured(): string {
  return (process.env.PROVIDER_TOPUP ?? '').trim().toLowerCase()
}
