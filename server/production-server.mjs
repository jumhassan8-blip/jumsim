/**
 * Jum e-SIM — production server (Module 6).
 *
 * Responsibilities:
 *   /v1/esimgo/*        provider proxy (key stays server-side)
 *   POST /v1/orders     price authority · disposable-email block · fraud hold ·
 *                       idempotency · retry w/ backoff · request-ID logging
 *   POST /webhooks/stripe   signature-verified events (unsigned → rejected)
 *   POST /v1/refund     Stripe refund + eSIM Go cancel + customer email
 *   POST /v1/receipts   SendGrid/Resend receipt from support@jumesim.com
 *   GET  /v1/admin/digest   weekly sales/failures/refund-rate digest
 *
 * All secrets come from env vars (see /.env.example). Never commit keys.
 * Run: node server/production-server.mjs
 */
import http from 'node:http'
import crypto from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

/* Load local env files (.env, then .env.local) so server-side secrets like
 * ESIM_GO_API_KEY are available when run outside a managed host — same
 * behaviour as scripts/dev-api.mjs and Vercel's env injection. Already-set
 * process.env values win; values are never logged. */
function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return
  for (const line of readFileSync(filePath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
    if (!m) continue
    const name = m[1]
    if (name in process.env) continue
    process.env[name] = m[2].trim().replace(/^["']|["']$/g, '')
  }
}
const serverDir = path.dirname(fileURLToPath(import.meta.url))
loadEnvFile(path.join(serverDir, '../.env'))
loadEnvFile(path.join(serverDir, '../.env.local'))

const PORT = Number(process.env.PORT ?? 8788)
const {
  ESIM_GO_API_KEY,
  ESIMGO_BASE_URL = 'https://api.esim-go.com/v2.4',
  PROVIDER_SETUP_TOKEN, // server-to-server auth for /v1/esimgo/* admin routes
  STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET,
  STRIPE_APPLE_PAY_MERCHANT_ID,
  SENDGRID_API_KEY,
  RESEND_API_KEY,
  MAIL_FROM = 'support@jumesim.com',
  ADMIN_EMAIL,
  APP_ORIGIN = '*',
  ORDER_RATE_LIMIT = '5', // per minute per IP
  FRAUD_CARD_ESIM_LIMIT = '3', // >3 eSIMs/24h on one card → hold
  DIGEST_INTERVAL_MS = String(7 * 24 * 60 * 60 * 1000),
} = process.env

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pricing = JSON.parse(
  readFileSync(path.join(__dirname, '../public/pricing.json'), 'utf8'),
)

/* ------------------------------------------------------------------ */
/* tiny helpers                                                        */
/* ------------------------------------------------------------------ */

const MAX_ATTEMPTS = 3
async function withRetry(fn, label) {
  let lastErr
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await fn(attempt)
    } catch (err) {
      lastErr = err
      const status = err?.status ?? err?.cause?.status
      const permanent = typeof status === 'number' && status >= 400 && status < 500 && status !== 429
      log(label, { attempt, error: String(err), permanent })
      if (permanent || attempt === MAX_ATTEMPTS) throw err
      await new Promise((r) => setTimeout(r, 400 * 2 ** (attempt - 1) + Math.random() * 100))
    }
  }
  throw lastErr
}

function log(event, data) {
  const line = JSON.stringify({ t: new Date().toISOString(), event, ...data })
  console.log(line) // in production: ship stdout to the log aggregator
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

async function readBody(req) {
  const chunks = []
  for await (const c of req) chunks.push(c)
  return Buffer.concat(chunks)
}

/** stripe REST helper (no SDK dependency in this reference server) */
async function stripe(pathname, params, method = 'POST') {
  if (!STRIPE_SECRET_KEY) throw Object.assign(new Error('Stripe not configured'), { status: 500 })
  const res = await fetch(`https://api.stripe.com/v1${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: method === 'GET' ? undefined : new URLSearchParams(params ?? {}),
  })
  const body = await res.json()
  if (!res.ok) throw Object.assign(new Error(body.error?.message ?? 'stripe_error'), { status: res.status })
  return body
}

async function esimGo(pathname, init = {}) {
  if (!ESIM_GO_API_KEY) {
    throw Object.assign(new Error('eSIM Go not configured (ESIM_GO_API_KEY)'), { status: 500 })
  }
  const res = await fetch(`${ESIMGO_BASE_URL}${pathname}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${ESIM_GO_API_KEY}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  })
  const body = await res.json().catch(() => ({}))
  const requestId = res.headers.get('x-request-id') ?? res.headers.get('request-id') ?? null
  log('esimgo_call', { path: pathname, status: res.status, requestId })
  if (!res.ok) {
    throw Object.assign(new Error(body.error ?? body.message ?? `esimgo_${res.status}`), {
      status: res.status,
      requestId,
    })
  }
  return body
}

/* ------------------------------------------------------------------ */
/* stores (in-memory reference — swap for Postgres/Firestore)          */
/* ------------------------------------------------------------------ */

const orders = new Map() // idempotencyKey|orderId → order record
const rateBuckets = new Map() // ip → timestamps[]
const cardUsage = new Map() // cardFingerprint → timestamps[]

const roundCents = (n) => Math.round(n * 100) / 100

function isDisposable(email) {
  const domain = String(email).split('@')[1]?.toLowerCase() ?? ''
  return DISPOSABLE.has(domain)
}
const DISPOSABLE = new Set([
  'tempmail.com', 'temp-mail.org', '10minutemail.com', 'guerrillamail.com',
  'mailinator.com', 'yopmail.com', 'throwawaymail.com', 'fakeinbox.com',
  'getnada.com', 'dispostable.com', 'trashmail.com', 'sharklasers.com',
])

function rateLimited(ip) {
  const now = Date.now()
  const windowMs = 60_000
  const recent = (rateBuckets.get(ip) ?? []).filter((t) => now - t < windowMs)
  if (recent.length >= Number(ORDER_RATE_LIMIT)) {
    rateBuckets.set(ip, recent)
    return true
  }
  recent.push(now)
  rateBuckets.set(ip, recent)
  return false
}

/* Per-IP token bucket for the key-bearing /v1/esimgo/* admin routes:
 * capacity 10, refill 10/min. Over budget → 429 + Retry-After. */
const ADMIN_RATE_CAPACITY = 10
const adminRateBuckets = new Map() // ip → { tokens, updated }
function takeAdminToken(ip) {
  const now = Date.now()
  const b = adminRateBuckets.get(ip) ?? { tokens: ADMIN_RATE_CAPACITY, updated: now }
  b.tokens = Math.min(ADMIN_RATE_CAPACITY, b.tokens + ((now - b.updated) / 60_000) * ADMIN_RATE_CAPACITY)
  b.updated = now
  if (b.tokens < 1) {
    adminRateBuckets.set(ip, b)
    return Math.max(1, Math.ceil(((1 - b.tokens) * 60_000) / ADMIN_RATE_CAPACITY / 1000))
  }
  b.tokens -= 1
  adminRateBuckets.set(ip, b)
  return null
}

/**
 * Gate for /v1/esimgo/* admin routes. Server-to-server only:
 * `Authorization: Bearer <PROVIDER_SETUP_TOKEN>` or `x-server-token`.
 * Answers 401/429 itself and returns false when the request must stop.
 */
async function esimAdminGate(req, res, ip) {
  const auth = req.headers.authorization ?? ''
  const header = req.headers['x-server-token']
  const tokenOk =
    Boolean(PROVIDER_SETUP_TOKEN) &&
    (auth === `Bearer ${PROVIDER_SETUP_TOKEN}` || header === PROVIDER_SETUP_TOKEN)
  if (!tokenOk) {
    log('esim_admin_denied', { ip, route: req.url })
    res.setHeader('WWW-Authenticate', 'Bearer')
    return json(res, 401, { error: 'unauthorized' }), false
  }
  const retryAfter = takeAdminToken(ip)
  if (retryAfter !== null) {
    log('esim_admin_rate_limited', { ip, retryAfter })
    res.setHeader('Retry-After', String(retryAfter))
    return json(res, 429, { error: 'rate_limited', retryAfterSeconds: retryAfter }), false
  }
  return true
}

/**
 * Server price authority (Module 6 §2): the client-sent price must equal
 * pricing.json rounded to the cent. Shares the exact plan-id grammar of
 * src/lib/plan-id.ts and src/providers/MockProvider.ts:
 *   unlimited : {slug}-unl-{days}d     · data : {slug}-{gb}gb-{days}d
 *   bundles   : {slug}-{label}         (matched against plan labels)
 */
function parsePlanId(planId) {
  let m = planId.match(/^(.*)-unl-(\d+)d$/)
  if (m) return { slug: m[1], kind: 'unlimited', days: Number(m[2]) }
  m = planId.match(/^(.*)-(\d+(?:p5)?)gb-(\d+)d$/)
  if (m) return { slug: m[1], kind: 'data', gb: Number(m[2].replace('p5', '.5')), days: Number(m[3]) }
  m = planId.match(/^(.*)-(.+)$/)
  if (m) return { slug: m[1], kind: 'bundle', bundleLabel: m[2] }
  return null
}

function authoritativePrice(planId, priceFromClient) {
  const parsed = parsePlanId(planId)
  if (!parsed) return { ok: false, expected: null }
  const iso = (pricing.slugs?.[parsed.slug] ?? parsed.slug).toUpperCase()
  const c = pricing.countries[iso]
  if (!c) return { ok: false, expected: null }
  let plan = null
  if (parsed.kind === 'unlimited') plan = c.unlimited.find((p) => p.days === parsed.days)
  else if (parsed.kind === 'data')
    plan = c.data.find((p) => (p.gb ?? 0) === parsed.gb && (p.days ?? 30) === parsed.days)
  else
    plan = c.data.find(
      (p) => p.label?.toLowerCase().replace(/[^a-z0-9]+/g, '') === parsed.bundleLabel,
    )
  if (!plan) return { ok: false, expected: null }
  const ok = roundCents(Number(priceFromClient)) === roundCents(plan.price)
  return { ok, expected: plan.price }
}

async function sendMail(to, subject, html) {
  if (RESEND_API_KEY) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: `Jum e-SIM <${MAIL_FROM}>`, to, subject, html }),
    })
    if (!res.ok) throw new Error(`resend failed: ${res.status}`)
    return
  }
  if (SENDGRID_API_KEY) {
    const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${SENDGRID_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: { email: MAIL_FROM },
        subject,
        content: [{ type: 'text/html', value: html }],
      }),
    })
    if (!res.ok) throw new Error(`sendgrid failed: ${res.status}`)
    return
  }
  log('mail_dry_run', { to, subject })
}

function receiptHtml(order) {
  const deep = `${(process.env.APP_ORIGIN ?? 'https://jumesim.com').split(',')[0].trim()}/esims/${order.iccid}`
  return `<p>Hi,</p><p>Your Jum e-SIM order <b>${order.id}</b> is confirmed.</p>
<ul><li>ICCID: ${order.iccid}</li><li>Amount: $${order.priceUSD.toFixed(2)}</li></ul>
<p><a href="${deep}">Open your eSIM in the app</a></p>
<p>Need help? Reply to this email or write to ${MAIL_FROM}.</p>`
}

/* ------------------------------------------------------------------ */
/* request handling                                                    */
/* ------------------------------------------------------------------ */

const server = http.createServer(async (req, res) => {
  const started = Date.now()
  const requestId = crypto.randomUUID()
  res.setHeader('x-request-id', requestId)
  res.on('finish', () => {
    if (req.url === '/health') return
    log('request', {
      requestId,
      method: req.method,
      route: (req.url ?? '/').split('?')[0],
      status: res.statusCode,
      latencyMs: Date.now() - started,
    })
  })
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`)
  const route = `${req.method} ${url.pathname}`
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() ?? req.socket.remoteAddress ?? '?'

  res.setHeader('Access-Control-Allow-Origin', APP_ORIGIN)
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Idempotency-Key')
  if (req.method === 'OPTIONS') return res.end()

  try {
    if (route === 'GET /health') {
      return json(res, 200, {
        ok: true,
        esimgo: Boolean(ESIM_GO_API_KEY),
        stripe: Boolean(STRIPE_SECRET_KEY),
        mail: Boolean(RESEND_API_KEY || SENDGRID_API_KEY),
      })
    }

    /* ---- provider proxy: catalog / products / usage / cancel ----
     * These four reach the eSIM Go key with caller-supplied parameters,
     * so they sit behind the admin gate (PROVIDER_SETUP_TOKEN — the same
     * server-to-server token the deploy step uses) AND a per-IP token
     * bucket (capacity 10, refill 10/min → 429 + Retry-After). The public
     * order endpoint below stays open for guest checkout — its
     * protection is the Stripe payment itself plus the price authority,
     * disposable-domain and card-velocity checks. */
    if (route === 'GET /v1/esimgo/catalog') {
      if (await esimAdminGate(req, res, ip)) {
        const raw = await withRetry(() => esimGo('/packages?perPage=300'), 'catalog')
        return json(res, 200, raw)
      }
      return
    }
    if (route === 'GET /v1/esimgo/products') {
      if (await esimAdminGate(req, res, ip)) {
        const country = url.searchParams.get('country') ?? ''
        const raw = await withRetry(() => esimGo(`/packages?country=${encodeURIComponent(country)}`), 'products')
        return json(res, 200, raw)
      }
      return
    }
    if (route === 'GET /v1/esimgo/usage') {
      if (await esimAdminGate(req, res, ip)) {
        const iccid = url.searchParams.get('iccid') ?? ''
        const raw = await withRetry(() => esimGo(`/esims/${encodeURIComponent(iccid)}/usage`), 'usage')
        return json(res, 200, raw)
      }
      return
    }
    if (route.startsWith('POST /v1/esimgo/orders/') && route.endsWith('/cancel')) {
      if (await esimAdminGate(req, res, ip)) {
        const orderId = route.split('/')[4]
        await withRetry(() => esimGo(`/orders/${encodeURIComponent(orderId)}`, { method: 'DELETE' }), 'cancel')
        return json(res, 200, { ok: true })
      }
      return
    }

    /* ---- order creation (the money path) ---- */
    if (route === 'POST /v1/esimgo/orders') {
      const idempotencyKey = req.headers['idempotency-key'] ?? crypto.randomUUID()
      const body = JSON.parse((await readBody(req)).toString('utf8') || '{}')
      const { planId, email, priceUSD, paymentMethodId, topUpFor } = body

      if (rateLimited(ip)) {
        log('rate_limited', { ip })
        return json(res, 429, { error: 'rate_limited' })
      }
      if (isDisposable(email)) {
        log('disposable_email_blocked', { email })
        return json(res, 400, { error: 'disposable_email' })
      }

      // idempotency: same key returns the existing order, never a duplicate
      const existing = orders.get(String(idempotencyKey))
      if (existing) return json(res, 200, existing)

      // price authority — reject any client/server mismatch (rounded to cents)
      const priceCheck = authoritativePrice(String(planId), priceUSD)
      if (!priceCheck.ok) {
        log('price_rejected', { planId, client: priceUSD, expected: priceCheck.expected })
        return json(res, 409, { error: 'price_mismatch', expected: priceCheck.expected })
      }

      // fraud: same card → more than N eSIMs in 24h goes to manual review hold
      const cardFp = paymentMethodId ? crypto.createHash('sha256').update(String(paymentMethodId)).digest('hex').slice(0, 16) : null
      let held = false
      if (cardFp) {
        const now = Date.now()
        const day = 24 * 60 * 60 * 1000
        const uses = (cardUsage.get(cardFp) ?? []).filter((t) => now - t < day)
        if (uses.length >= Number(FRAUD_CARD_ESIM_LIMIT)) held = true
        uses.push(now)
        cardUsage.set(cardFp, uses)
      }

      // 1) authorize only — capture AFTER provider confirms the order
      let payment
      try {
        payment = await withRetry(
          () =>
            stripe('/payment_intents', {
              amount: String(Math.round(priceCheck.expected * 100)),
              currency: pricing.currency?.toLowerCase() ?? 'usd',
              payment_method: String(paymentMethodId),
              confirmation_method: 'manual',
              confirm: 'true',
              capture_method: 'manual', // authorize only — NEVER auto-capture
              'metadata[planId]': String(planId),
              'metadata[email]': String(email),
            }),
          'stripe_authorize',
        )
      } catch (err) {
        log('payment_failed', { planId, error: String(err) })
        return json(res, 402, { error: 'payment_failed_no_charge' })
      }

      // 2) create the order at the provider — fail loud, void the auth
      try {
        const order = await withRetry(
          () =>
            esimGo('/orders', {
              method: 'POST',
              body: JSON.stringify({
                package: planId,
                quantity: 1,
                type: topUpFor ? 'TOPUP' : 'NEW',
                ...(topUpFor ? { iccid: topUpFor } : {}),
              }),
            }),
          'create_order',
        )
        // 3) capture now the provider confirmed
        const captured = await stripe(`/payment_intents/${payment.id}/capture`, {})
        const record = {
          id: order?.orderId ?? crypto.randomUUID(),
          iccid: order?.esims?.[0]?.iccid ?? null,
          lpaString: order?.esims?.[0]?.lpaString ?? null,
          qrUrl: order?.esims?.[0]?.qrUrl ?? null,
          expiresAt: order?.esims?.[0]?.expireDate ?? null,
          planId,
          email,
          priceUSD: priceCheck.expected,
          status: held ? 'hold' : 'paid',
          paymentId: payment.id,
          createdAt: Date.now(),
          keyedBy: email, // stored server-side keyed by user email
        }
        orders.set(String(idempotencyKey), record)
        log('order_created', { id: record.id, iccid: record.iccid, held, requestId: order?.requestId })
        void captured

        // receipt email with deep link
        try {
          await sendMail(String(email), `Your Jum e-SIM order ${record.id}`, receiptHtml(record))
        } catch (err) {
          log('receipt_failed', { orderId: record.id, error: String(err) })
        }
        return json(res, 200, record)
      } catch (err) {
        // provider failed → void the authorization, user is NOT charged
        try {
          await stripe(`/payment_intents/${payment.id}/cancel`, {})
        } catch (voidErr) {
          log('void_failed', { paymentId: payment.id, error: String(voidErr) })
        }
        log('order_failed_voided', { planId, error: String(err) })
        return json(res, 502, { error: 'provider_failed_no_charge' })
      }
    }

    /* ---- Stripe webhook (signature-verified; unsigned rejected) ---- */
    if (route === 'POST /webhooks/stripe') {
      const raw = await readBody(req)
      const sig = req.headers['stripe-signature']
      if (!STRIPE_WEBHOOK_SECRET || !sig) {
        log('webhook_unsigned_rejected', { ip })
        return json(res, 400, { error: 'missing_signature' })
      }
      const parts = Object.fromEntries(
        String(sig).split(',').map((kv) => {
          const idx = kv.indexOf('=')
          return [kv.slice(0, idx), kv.slice(idx + 1)]
        }),
      )
      const expected = crypto
        .createHmac('sha256', STRIPE_WEBHOOK_SECRET)
        .update(`${parts.t}.${raw.toString('utf8')}`)
        .digest('hex')
      const fresh = Math.abs(Date.now() / 1000 - Number(parts.t)) < 300
      if (!fresh || parts.v1 !== expected) {
        log('webhook_bad_signature', { ip })
        return json(res, 400, { error: 'invalid_signature' })
      }
      const event = JSON.parse(raw.toString('utf8'))
      log('webhook', { type: event.type, id: event.id })
      return json(res, 200, { received: true })
    }

    /* ---- refund flow (support-triggered from order detail) ---- */
    if (route === 'POST /v1/refund') {
      const body = JSON.parse((await readBody(req)).toString('utf8') || '{}')
      const { orderId, reason } = body
      const record = [...orders.values()].find((o) => o.id === orderId)
      if (!record) return json(res, 404, { error: 'order_not_found' })
      if (record.status === 'refunded') return json(res, 409, { error: 'already_refunded' })
      try {
        await withRetry(() => stripe('/refunds', { payment_intent: record.paymentId }), 'stripe_refund')
        await withRetry(() => esimGo(`/orders/${encodeURIComponent(orderId)}`, { method: 'DELETE' }), 'esimgo_cancel')
        record.status = 'refunded'
        record.refundedAt = Date.now()
        record.refundReason = String(reason ?? '')
        log('refunded', { orderId, reason })
        try {
          await sendMail(record.email, `Refund for Jum order ${orderId}`, `<p>Your refund of $${record.priceUSD.toFixed(2)} for order ${orderId} has been issued to your original payment method (2–5 business days).</p>`)
        } catch {
          /* email failure is non-fatal to the refund */
        }
        return json(res, 200, { ok: true })
      } catch (err) {
        log('refund_failed', { orderId, error: String(err) })
        return json(res, 500, { error: 'refund_failed' })
      }
    }

    /* ---- receipts ---- */
    if (route === 'POST /v1/receipts') {
      const body = JSON.parse((await readBody(req)).toString('utf8') || '{}')
      await sendMail(String(body.email ?? ''), String(body.subject ?? 'Jum e-SIM receipt'), String(body.html ?? ''))
      return json(res, 200, { ok: true })
    }

    /* ---- weekly admin digest ---- */
    if (route === 'GET /v1/admin/digest') {
      const all = [...orders.values()]
      const week = all.filter((o) => Date.now() - o.createdAt < 7 * 24 * 60 * 60 * 1000)
      const refunds = all.filter((o) => o.status === 'refunded')
      const digest = {
        sales: week.filter((o) => o.status === 'paid').length,
        revenueUSD: roundCents(week.filter((o) => o.status === 'paid').reduce((s, o) => s + o.priceUSD, 0)),
        failures: week.filter((o) => o.status === 'failed').length,
        holds: week.filter((o) => o.status === 'hold').length,
        refundRate: all.length ? refunds.length / all.length : 0,
      }
      if (ADMIN_EMAIL) {
        await sendMail(ADMIN_EMAIL, 'Jum weekly digest', `<pre>${JSON.stringify(digest, null, 2)}</pre>`).catch(() => {})
      }
      return json(res, 200, digest)
    }

    return json(res, 404, { error: 'not_found' })
  } catch (err) {
    console.error(err)
    return json(res, 500, { error: 'internal' })
  }
})

/* weekly digest timer (the endpoint also exists for external cron) */
if (ADMIN_EMAIL) {
  setInterval(() => {
    fetch(`http://localhost:${PORT}/v1/admin/digest`).catch(() => {})
  }, Number(DIGEST_INTERVAL_MS)).unref()
}

server.listen(PORT, () => {
  // boot check logs key PRESENCE and LENGTH only — never the value (brief §4)
  log('server_started', {
    port: PORT,
    esimgo: ESIM_GO_API_KEY ? `key present (len ${ESIM_GO_API_KEY.length})` : 'MISSING',
    stripe: Boolean(STRIPE_SECRET_KEY),
    applePayMerchant: STRIPE_APPLE_PAY_MERCHANT_ID ?? null,
  })
})
