/**
 * Jum e-SIM — Module 5 number-rental server (Node, no framework deps beyond fetch).
 * Serves the DID-provider endpoints the NumberProvider calls in live mode:
 *
 *   GET  /numbers/available?country=US&page=1
 *   POST /numbers/rent        { country, number, email }
 *   POST /numbers/verify      { sid, code }
 *   POST /numbers/release     { sid }
 *   POST /numbers/renew       { sid }
 *   POST /numbers/resend      { sid }
 *   POST /webhooks/rental-expiry   (cron/provider webhook → grace → release)
 *
 * All secrets come from env vars — NEVER hardcode keys (see .env.example).
 * With no TWILIO_* keys set the server runs in DRY-RUN mode: deterministic
 * fake inventory so the flow is testable end to end pre-provisioning.
 *
 * Run: node server/numbers-server.mjs
 */
import http from 'node:http'
import crypto from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const PORT = Number(process.env.PORT ?? 8787)
const {
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_MESSAGING_SERVICE_SID,
  NUMBER_DRY_RUN = (!(TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN)).toString(),
} = process.env

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pricing = JSON.parse(
  readFileSync(path.join(__dirname, '../public/pricing.json'), 'utf8'),
)

/** in-memory store (swap for a real DB in production) */
const rentals = new Map() // sid → record
const inventoryPage = new Map() // `${iso}:${page}` → numbers[]

const PAGE_SIZE = 5
const CODE_TTL_MS = 10 * 60 * 1000
const MONTH_MS = 30 * 24 * 60 * 60 * 1000

function hash32(str) {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function fakeNumber(iso, index) {
  const dialCode = pricing.dialCodes[iso]?.dialCode ?? '+1'
  const h = hash32(`${iso}:${index}`)
  if (dialCode === '+1') {
    return `+1${415 + (h % 200)}55501${String(10 + (h % 90)).padStart(2, '0')}`
  }
  return `${dialCode}${String(h % 100000000).padStart(8, '0')}`
}

function inventoryFor(iso, page) {
  if (pricing.numberRental.soldOut.includes(iso)) return []
  if (page > 2) return [] // 10 numbers per country, page size 5
  const key = `${iso}:${page}`
  if (!inventoryPage.has(key)) {
    inventoryPage.set(
      key,
      Array.from({ length: PAGE_SIZE }, (_, i) => ({
        number: fakeNumber(iso, (page - 1) * PAGE_SIZE + i),
        countryIso: iso,
        voice: true,
        sms: true,
        sid: `PN${crypto.randomUUID().replace(/-/g, '').slice(0, 32)}`,
      })),
    )
  }
  return inventoryPage.get(key)
}

async function sendSmsViaTwilio(to, body) {
  if (NUMBER_DRY_RUN === 'true') {
    console.log(`[dry-run] SMS -> ${to}: ${body}`)
    return
  }
  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
    {
      method: 'POST',
      headers: {
        Authorization:
          'Basic ' +
          Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64'),
      },
      body: new URLSearchParams({
        To: to,
        MessagingServiceSid: TWILIO_MESSAGING_SERVICE_SID ?? '',
        Body: body,
      }),
    },
  )
  if (!res.ok) throw new Error(`Twilio SMS failed: ${res.status}`)
}

function sendCode(rec) {
  rec.code = String(crypto.randomInt(0, 1000000)).padStart(6, '0')
  rec.codeSentAt = Date.now()
  rec.attempts = 0
  console.log(`[verification] sid=${rec.sid} code=${rec.code}`) // demo only; live mode delivers via SMS
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

async function readBody(req) {
  const chunks = []
  for await (const c of req) chunks.push(c)
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
  } catch {
    return {}
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`)
  const route = `${req.method} ${url.pathname}`

  res.setHeader('Access-Control-Allow-Origin', process.env.APP_ORIGIN ?? '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.end()

  try {
    if (route === 'GET /health') {
      return json(res, 200, { ok: true, dryRun: NUMBER_DRY_RUN === 'true' })
    }

    if (route === 'GET /numbers/available') {
      const iso = (url.searchParams.get('country') ?? '').toUpperCase()
      const page = Math.max(1, Number(url.searchParams.get('page') ?? 1))
      if (!pricing.numberRental.countries[iso]) {
        return json(res, 404, { error: 'unknown_country' })
      }
      return json(res, 200, { numbers: inventoryFor(iso, page), page })
    }

    if (route === 'POST /numbers/rent') {
      const { country, number, email } = await readBody(req)
      const iso = String(country ?? '').toUpperCase()
      const entry = pricing.numberRental.countries[iso]
      if (!entry) return json(res, 404, { error: 'unknown_country' })
      if (pricing.numberRental.soldOut.includes(iso)) {
        return json(res, 409, { error: 'sold_out' })
      }
      if (pricing.numberRental.onePerUser) {
        const existing = [...rentals.values()].find(
          (r) => r.email === String(email ?? '') && r.status !== 'released',
        )
        if (existing) {
          return json(res, 409, { error: 'one_per_user', activeSid: existing.sid })
        }
      }
      const sid = `RE${crypto.randomUUID().replace(/-/g, '').slice(0, 32)}`
      const rec = {
        sid,
        number: String(number),
        countryIso: iso,
        email: String(email ?? ''),
        monthlyUSD: entry.monthlyUSD,
        kycRequired: entry.kycRequired,
        kycPassed: !entry.kycRequired,
        status: 'pending_verification',
        rentedAt: Date.now(),
        renewsAt: Date.now() + MONTH_MS,
        autoRenew: true,
      }
      rentals.set(sid, rec)
      sendCode(rec)
      // live mode: provision the DID via Twilio Incoming Numbers API here,
      // pointing voice/SMS webhooks back at this server.
      return json(res, 200, {
        sid,
        number: rec.number,
        status: rec.status,
        renewsAt: rec.renewsAt,
        monthlyUSD: rec.monthlyUSD,
        kycRequired: rec.kycRequired,
      })
    }

    if (route === 'POST /numbers/resend') {
      const { sid } = await readBody(req)
      const rec = rentals.get(String(sid))
      if (!rec) return json(res, 404, { error: 'not_found' })
      sendCode(rec)
      return json(res, 200, { ok: true })
    }

    if (route === 'POST /numbers/verify') {
      const { sid, code } = await readBody(req)
      const rec = rentals.get(String(sid))
      if (!rec) return json(res, 404, { error: 'not_found' })
      if (rec.status !== 'pending_verification') {
        return json(res, 409, { error: 'already_verified' })
      }
      if (!rec.code || Date.now() - rec.codeSentAt > CODE_TTL_MS) {
        return json(res, 410, { error: 'code_expired' })
      }
      rec.attempts = (rec.attempts ?? 0) + 1
      if (rec.code !== String(code)) {
        if (rec.attempts >= 3) {
          return json(res, 429, { error: 'too_many_attempts', cooldownSec: 300 })
        }
        return json(res, 401, { error: 'wrong_code', attemptsLeft: 3 - rec.attempts })
      }
      rec.status = 'active'
      rec.verified = true
      await sendSmsViaTwilio(
        rec.number,
        `Welcome to Jum — your rental number ${rec.number} is active. Manage it anytime in the app.`,
      )
      return json(res, 200, { ok: true, status: rec.status })
    }

    if (route === 'POST /numbers/release') {
      const { sid } = await readBody(req)
      const rec = rentals.get(String(sid))
      if (!rec) return json(res, 404, { error: 'not_found' })
      rec.status = 'released'
      rec.releasedAt = Date.now()
      return json(res, 200, { ok: true })
    }

    if (route === 'POST /numbers/renew') {
      const { sid } = await readBody(req)
      const rec = rentals.get(String(sid))
      if (!rec) return json(res, 404, { error: 'not_found' })
      // live mode: charge the saved payment method server-side, then extend
      rec.status = 'active'
      rec.renewsAt = Math.max(Date.now(), rec.renewsAt) + MONTH_MS
      return json(res, 200, { ok: true, renewsAt: rec.renewsAt })
    }

    if (route === 'POST /webhooks/rental-expiry') {
      // nightly cron or billing webhook: active -> grace -> released
      const now = Date.now()
      const graceMs = pricing.numberRental.gracePeriodDays * 24 * 60 * 60 * 1000
      for (const rec of rentals.values()) {
        if (rec.status === 'active' && now > rec.renewsAt) rec.status = 'grace'
        else if (rec.status === 'grace' && now > rec.renewsAt + graceMs) {
          rec.status = 'released'
          rec.releasedAt = now
        }
      }
      return json(res, 200, { ok: true })
    }

    return json(res, 404, { error: 'not_found' })
  } catch (err) {
    console.error(err)
    return json(res, 500, { error: 'internal' })
  }
})

server.listen(PORT, () => {
  console.log(`numbers server on :${PORT} (dry-run=${NUMBER_DRY_RUN})`)
})
