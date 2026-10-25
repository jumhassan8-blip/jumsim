import type { IncomingMessage, ServerResponse } from 'node:http'

export type Handler = (req: IncomingMessage, res: ServerResponse) => void | Promise<void>

const jsonHeaders = { 'Content-Type': 'application/json; charset=utf-8' }

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}

export function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > 64 * 1024) {
        reject(new Error('payload_too_large'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => {
      if (chunks.length === 0) return resolve({})
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        reject(new Error('invalid_json'))
      }
    })
    req.on('error', reject)
  })
}

/**
 * CORS locked to the app's domain(s).
 *
 * Allowed origins come from APP_ORIGIN (comma-separated). In MOCK_MODE,
 * localhost / 127.0.0.1 on any port are also allowed so the local dev
 * harness (`npm run api`) can talk to the functions. Requests from any
 * other origin get no ACAO header and are rejected outright for API routes.
 */
export function corsOrigin(req: IncomingMessage): string | null {
  const origin = req.headers.origin
  if (!origin) return '*' // same-origin / server-to-server / curl
  const allowed = (process.env.APP_ORIGIN ?? 'https://jumesim.com')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (allowed.includes(origin)) return origin
  if (process.env.MOCK_MODE === 'true' && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
    return origin
  }
  return null
}

export function handleCors(req: IncomingMessage, res: ServerResponse): boolean {
  const origin = corsOrigin(req)
  if (origin === null) {
    sendJson(res, 403, { error: 'origin_not_allowed' })
    return true
  }
  res.setHeader('Access-Control-Allow-Origin', origin)
  res.setHeader('Vary', 'Origin')
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Idempotency-Key')
    res.setHeader('Access-Control-Max-Age', '600')
    res.statusCode = 204
    res.end()
    return true
  }
  return false
}

export function assertPost(req: IncomingMessage, res: ServerResponse): boolean {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    sendJson(res, 405, { error: 'method_not_allowed' })
    return false
  }
  return true
}

/** Wrap a handler with JSON-body parsing, CORS, and consistent errors. */
export function withApi(handler: (body: Record<string, unknown>, req: IncomingMessage, res: ServerResponse) => Promise<void> | void): Handler {
  return async (req, res) => {
    if (handleCors(req, res)) return
    if (!assertPost(req, res)) return
    let body: Record<string, unknown>
    try {
      body = await readJson(req)
    } catch (err) {
      sendJson(res, 400, { error: err instanceof Error ? err.message : 'bad_request' })
      return
    }
    try {
      await handler(body, req, res)
    } catch (err) {
      sendJson(res, 500, { error: 'internal_error', detail: err instanceof Error ? err.message : String(err) })
    }
  }
}

export { jsonHeaders }
