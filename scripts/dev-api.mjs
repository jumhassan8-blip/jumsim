#!/usr/bin/env node
/**
 * Local runner for the Vercel serverless functions in api/.
 *
 *   npm run api        → bundles api/*.ts with esbuild and serves /api/* on :8789
 *
 * The Vite dev server and `vite preview` proxy /api → this server
 * (see vite.config.ts), so the app talks to exactly the same routes it
 * will hit on Vercel.
 */
import { createServer } from 'node:http'
import { copyFileSync, existsSync, readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { build } from 'esbuild'

/* Load local env files (.env, then .env.local) so server-side secrets like
 * STRIPE_SECRET_KEY are available to the api routes in dev — mirroring what
 * Vercel does with project env vars. Already-set process.env values win;
 * values are only NAME-checked here and never logged. */
function loadEnvFile(path) {
  if (!existsSync(path)) return
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
    if (!m) continue
    const name = m[1]
    if (name in process.env) continue
    const value = m[2].trim()
    process.env[name] = value.replace(/^["']|["']$/g, '')
  }
}
loadEnvFile(new URL('../.env', import.meta.url).pathname)
loadEnvFile(new URL('../.env.local', import.meta.url).pathname)

process.env.MOCK_MODE ??= 'true'
process.env.APP_ORIGIN ??= 'http://localhost:5173,http://localhost:4173,http://127.0.0.1:4173'

const ROUTES = {
  '/api/create-payment-intent': 'create-payment-intent',
  '/api/confirm-order': 'confirm-order',
  '/api/refund/execute': 'refund/execute',
  '/api/webhooks/esimgo': 'webhooks/esimgo',
  '/api/support/chat': 'support/chat',
  '/api/calls/balance': 'calls/balance',
  '/api/calls/start': 'calls/start',
  '/api/calls/end': 'calls/end',
  '/api/calls/credit': 'calls/credit',
  '/api/calls/payment-intent': 'calls/payment-intent',
  '/api/orders/status': 'orders/status',
  '/api/fx': 'fx',
  '/api/auth/reassociate': 'auth/reassociate',
  '/api/checkout/plan': 'checkout/plan',
  '/api/checkout/create-payment-intent': 'checkout/create-payment-intent',
  '/api/checkout/webhook': 'checkout/webhook',
  '/api/checkout/analytics': 'checkout/analytics',
  '/api/checkout/email-instructions': 'checkout/email-instructions',
  '/api/checkout/convert-account': 'checkout/convert-account',
  '/api/webhooks/esimaccess': 'webhooks/esimaccess',
  '/api/providers/setup': 'providers/setup',
  '/api/topup/state': 'topup/state',
  '/api/topup/operators/detect': 'topup/operators/detect',
  '/api/topup/catalog': 'topup/catalog',
  '/api/topup/quote': 'topup/quote',
  '/api/topup/execute': 'topup/execute',
  '/api/topup/status': 'topup/status',
  '/api/topup/saved-numbers': 'topup/saved-numbers',
  '/api/topup/auto': 'topup/auto',
  '/api/topup/auto/tick': 'topup/auto-tick',
  '/api/topup/waitlist': 'topup/waitlist',
  '/api/topup/balance': 'topup/balance',
  '/api/topup/balance/fund': 'topup/balance-fund',
  '/api/gift/create': 'gift/create',
  '/api/gift/redeem': 'gift/redeem',
  '/api/gift/preview': 'gift/preview',
  '/api/gift/mine': 'gift/mine',
  '/api/gift/resend': 'gift/resend',
  '/api/gift/deliver-due': 'gift/deliver-due',
  '/api/gift/admin': 'gift/admin',
  '/api/gift/test-fire-webhook': 'gift/test-fire-webhook',
}

const outdir = new URL('../.api-dist/', import.meta.url).pathname
await build({
  entryPoints: Object.values(ROUTES).map((name) => new URL(`../api/${name}.ts`, import.meta.url).pathname),
  outdir,
  bundle: true,
  splitting: true, // shared chunks → lib/orders.ts store is ONE instance across routes (local dev only; on Vercel each function is isolated — use KV_REST_API_*)
  platform: 'node',
  format: 'esm',
  target: 'node18',
  outExtension: { '.js': '.mjs' },
  logLevel: 'silent',
})

// kb.md is read at runtime relative to the function bundle (same layout as
// Vercel's includeFiles) — keep it next to the bundled functions.
copyFileSync(new URL('../api/kb.md', import.meta.url), new URL('../.api-dist/kb.md', import.meta.url))

const handlers = {}
for (const [route, name] of Object.entries(ROUTES)) {
  const mod = await import(`${outdir}${name}.mjs`)
  handlers[route] = mod.default
}

const port = Number(process.env.API_PORT ?? 8789)

/* ------------------------------------------------------------------ */
/* security hardening (brief §3/§4): per-IP token bucket on            */
/* provider-touching routes + request audit log. Capacity 10, refill   */
/* 10/min — 12 rapid requests → 10 succeed, 2 × 429 + Retry-After.     */
/* ------------------------------------------------------------------ */
const RATE_LIMITED_ROUTES = new Set([
  '/api/confirm-order', // legacy direct provider path (also auth-gated 401)
  '/api/providers/setup', // provider wiring (already Bearer-gated)
  // /api/refund/execute deliberately NOT limited here: its provider calls
  // are bounded to orders already in our store (orderId → stored iccid,
  // no caller-supplied ICCID), and the abuse-test suite fires concurrent
  // refunds to prove the idempotency lock. The production standalone
  // server limits its own /v1/esimgo/* admin bucket separately.
])
const RATE_CAPACITY = 10
const rateBuckets = new Map() // ip → { tokens, updated }

/** Take one token; returns Retry-After seconds when over budget, else null. */
function takeToken(ip) {
  const now = Date.now()
  const b = rateBuckets.get(ip) ?? { tokens: RATE_CAPACITY, updated: now }
  b.tokens = Math.min(RATE_CAPACITY, b.tokens + ((now - b.updated) / 60_000) * RATE_CAPACITY)
  b.updated = now
  if (b.tokens < 1) {
    rateBuckets.set(ip, b)
    return Math.max(1, Math.ceil(((1 - b.tokens) * 60_000) / RATE_CAPACITY / 1000))
  }
  b.tokens -= 1
  rateBuckets.set(ip, b)
  return null
}

createServer(async (req, res) => {
  const started = Date.now()
  const requestId = randomUUID()
  res.setHeader('x-request-id', requestId)
  res.on('finish', () => {
    if (req.url === '/health') return
    console.log(
      JSON.stringify({
        t: new Date().toISOString(),
        requestId,
        method: req.method,
        route: (req.url ?? '/').split('?')[0],
        status: res.statusCode,
        latencyMs: Date.now() - started,
      }),
    )
  })
  const url = (req.url ?? '/').split('?')[0]
  if (url === '/health' && req.method === 'GET') {
    res.end(JSON.stringify({ ok: true, mock: process.env.MOCK_MODE }))
    return
  }
  if (RATE_LIMITED_ROUTES.has(url) && req.method !== 'OPTIONS') {
    const retryAfter = takeToken(req.socket.remoteAddress ?? 'unknown')
    if (retryAfter !== null) {
      res.statusCode = 429
      res.setHeader('Content-Type', 'application/json')
      res.setHeader('Retry-After', String(retryAfter))
      res.end(JSON.stringify({ error: 'rate_limited', retryAfterSeconds: retryAfter }))
      return
    }
  }
  const handler = handlers[url]
  if (!handler) {
    res.statusCode = 404
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ error: 'not_found', route: url }))
    return
  }
  try {
    await handler(req, res)
  } catch (err) {
    if (!res.headersSent) {
      res.statusCode = 500
      res.setHeader('Content-Type', 'application/json')
    }
    if (!res.writableEnded) res.end(JSON.stringify({ error: 'internal_error', detail: String(err) }))
  }
}).listen(port, '127.0.0.1', () => {
  const keyLen = (process.env.ESIM_GO_API_KEY ?? '').length
  console.log(
    `[dev-api] esimgo: key ${keyLen ? `present (len ${keyLen})` : 'MISSING'} · MOCK_MODE=${process.env.MOCK_MODE} listening on http://127.0.0.1:${port}`,
  )
})
