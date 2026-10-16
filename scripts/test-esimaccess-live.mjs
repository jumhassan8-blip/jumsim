#!/usr/bin/env node
/**
 * LIVE eSIM Access acceptance test — runs ONLY with real credentials:
 *
 *   ESIMA_ACCESS_CODE=... ESIMA_SECRET_KEY=... node scripts/test-esimaccess-live.mjs
 *
 *   1. catalog loads from eSIM Access (package count > 0)
 *   2. one test order returns an install payload (order → poll → QR/ICCID)
 *   3. usage query answers for the esimTranNo
 *   4. optional: cancel the test eSIM for a refund (default ON — the test
 *      eSIM is unused; SET TEST_ESIMA_KEEP=1 to keep it)
 *
 * Costs a few cents of balance — that's the point of a test order.
 * Skips cleanly (exit 0) without credentials.
 */
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'

const code = process.env.ESIMA_ACCESS_CODE
const secret = process.env.ESIMA_SECRET_KEY
if (!code || !secret) {
  console.log('SKIP — set ESIMA_ACCESS_CODE + ESIMA_SECRET_KEY to run the live acceptance test')
  process.exit(0)
}

const out = `/tmp/esim-access-live-${process.pid}.mjs`
await build({
  entryPoints: [fileURLToPath(new URL('../api/providers/esimAccess.ts', import.meta.url))],
  bundle: true, platform: 'node', format: 'esm', target: 'node18',
  outfile: out, logLevel: 'silent',
})
const { createEsimAccessProvider } = await import(out)

const provider = createEsimAccessProvider({
  accessCode: code,
  secretKey: secret,
  // real timers, real pacing — we ARE hitting the live rate limit
})

const step = (n, ok, detail = '') => {
  console.log(`${ok ? '✅' : '❌'} ${n}${detail ? ` — ${detail}` : ''}`)
  if (!ok) process.exitCode = 1
}

// 1 ─ catalog
const catalog = await provider.catalog()
step('catalog loads from eSIM Access', catalog.length > 0, `${catalog.length} packages, ${new Set(catalog.map((p) => p.locationCode)).size} locations`)

// pick a cheap, fulfilful plan to exercise resolution
const pkg = catalog.find((p) => p.volumeGB > 0 && p.volumeGB <= 5 && p.costUSD <= 3) ?? catalog[0]
const fakePlanId = `united-states-${pkg.volumeGB}gb-${pkg.durationDays}d`
const resolved = await provider.resolvePackage(fakePlanId).catch(() => null)
step('resolvePackage maps a real planId', resolved !== null, resolved ? `${fakePlanId} → ${resolved.packageCode} ($${resolved.costUSD})` : `${fakePlanId} not resolvable (coverage filter working — pick another)`)

// 2 ─ test order → install payload
const reference = `jum_live_test_${Date.now()}`
const t0 = Date.now()
try {
  const order = await provider.createOrder({ planId: resolved ? fakePlanId : pkg.packageCode, email: 'test@jumesim.com', reference })
  step('createOrder returned orderNo', Boolean(order.providerOrderNo), order.providerOrderNo)

  let payload = order.payload
  for (let i = 0; i < 5 && !payload; i++) {
    await new Promise((r) => setTimeout(r, 3000))
    payload = await provider.installPayload(order.providerOrderNo)
  }
  step('install payload delivered', Boolean(payload?.iccid && payload?.qrUrl), payload ? `iccid ${payload.iccid} · esimTranNo ${payload.esimTranNo} · ${((Date.now() - t0) / 1000).toFixed(1)}s` : 'not provisioned after ~15s')

  if (payload?.esimTranNo) {
    // 3 ─ usage (fresh eSIM: zeros expected, but the endpoint must answer)
    const usage = await provider.usage(payload.esimTranNo).catch((e) => ({ error: String(e) }))
    step('usage query answers', !usage.error, usage.error ?? `used ${usage.usedBytes} / ${usage.totalBytes} bytes`)

    // 4 ─ optional cancel for refund
    if (!process.env.TEST_ESIMA_KEEP) {
      const cancel = await provider.cancel(payload.esimTranNo).catch((e) => ({ error: String(e) }))
      step('cancel (refund) accepted', cancel.ok === true, cancel.error ?? 'test eSIM cancelled, balance refunded')
    }
  }
} catch (err) {
  step('order flow', false, String(err))
}

console.log(process.exitCode ? '\nLIVE TEST FAILED' : '\nLIVE TEST PASSED')
