/**
 * Shared helpers for gift routes: auth context (Firebase token OR
 * server-to-server) and request IP. Same dual scheme as topup/shared.ts.
 */
import type { IncomingMessage } from 'node:http'
import { authenticate } from '../lib/auth'

export interface GiftCtx {
  uid: string | null
  ip: string
  authKind: 'firebase' | 'server' | 'guest'
}

export async function giftCtx(req: IncomingMessage): Promise<GiftCtx> {
  const ip =
    (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ??
    req.socket.remoteAddress ??
    'unknown'
  const auth = await authenticate(req).catch(() => null)
  if (!auth) return { uid: null, ip, authKind: 'guest' }
  return { uid: auth.kind === 'firebase' ? auth.uid : null, ip, authKind: auth.kind }
}

export const DAY_CAP_USD = 200
