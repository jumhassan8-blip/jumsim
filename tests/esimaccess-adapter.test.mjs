/**
 * eSIM Access adapter — offline test suite (mock fetch, no network).
 *
 *   node --test tests/esimaccess-adapter.test.mjs
 *
 * Covers: HMAC signature headers, ×10000 price normalization, bytes→GB,
 * 8 req/s rate limiting, exponential backoff, plan-grammar resolution,
 * coverage filter (unfulfillable → null), createOrder/installPayload/
 * usage/topUp/cancel/registerWebhook contract, provider selection flip.
 * Live end-to-end with real keys: scripts/test-esimaccess-live.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const bundlePath = `/tmp/esim-access-adapter-${process.pid}.mjs`
await build({
  entryPoints: [fileURLToPath(new URL('../api/providers/esimAccess.ts', import.meta.url))],
  bundle: true, platform: 'node', format: 'esm', target: 'node18',
  outfile: bundlePath, logLevel: 'silent',
})
const { createEsimAccessProvider, bytesToGB, parseApiTime } = await import(bundlePath)

// rateLimit ships as TS too — bundle it alongside
await build({
  entryPoints: [fileURLToPath(new URL('../api/providers/rateLimit.ts', import.meta.url))],
  bundle: true, platform: 'node', format: 'esm', target: 'node18',
  outfile: `/tmp/esim-rate-limit-${process.pid}.mjs`, logLevel: 'silent',
})
const rateLimit = await import(`/tmp/esim-rate-limit-${process.pid}.mjs`)

/* ── test doubles ─────────────────────────────────────────────────────── */

const ACCESS = 'TESTACCESS123'
const SECRET = 'testsecret_abc123'

function jsonRes(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) }
}

/** scripted fake of https://api.esimaccess.com/api/v1/open */
function fakeApi(routes) {
  const requests = []
  const fetchImpl = async (url, opts) => {
    const endpoint = url.replace('https://api.esimaccess.com/api/v1/open', '')
    requests.push({ endpoint, body: JSON.parse(opts.body), headers: opts.headers })
    const route = routes[endpoint]
    if (!route) return jsonRes({ success: false, errorCode: '404', errorMsg: endpoint }, 404)
    const result = await route(JSON.parse(opts.body), opts.headers)
    if (result instanceof Error) return jsonRes({ success: false, errorCode: '400001', errorMsg: String(result.message) }, 200)
    if (result && result.__httpStatus) return jsonRes({ success: false, errorCode: '500', errorMsg: 'boom' }, result.__httpStatus)
    return jsonRes({ success: true, errorCode: '0', errorMsg: null, obj: result })
  }
  return { fetchImpl, requests }
}

const NO_SLEEP = () => Promise.resolve()

const CATALOG = {
  packageList: [
    { packageCode: 'DE_5_30', slug: 'de_5_30', name: 'Germany 5GB 30Days', price: 120000, volume: 5368709120, duration: 30, location: 'DE', supportTopUpType: 2 },
    { packageCode: 'DE_1_7', slug: 'de_1_7', name: 'Germany 1GB 7Days', price: 88000, volume: 5368709120 / 10, duration: 7, location: 'DE', supportTopUpType: 0 },
    { packageCode: 'DE_UNL_7', slug: 'de_unl_7', name: 'Germany Unlimited 7Days', price: 150000, volume: -1, duration: 7, location: 'DE', supportTopUpType: 2 },
    { packageCode: 'US_5_30', slug: 'us_5_30', name: 'United States 5GB 30Days', price: 130000, volume: 5368709120, duration: 30, location: 'US', supportTopUpType: 2 },
    { packageCode: 'EU_10_30', slug: 'eu_10_30', name: 'Europe 10GB 30Days', price: 159900, volume: 10737418240, duration: 30, location: 'EU', supportTopUpType: 2 },
  ],
}

function makeProvider(routes, extra = {}) {
  const { fetchImpl, requests } = fakeApi(routes)
  const provider = createEsimAccessProvider({
    fetchImpl,
    sleepFn: NO_SLEEP,
    accessCode: ACCESS,
    secretKey: SECRET,
    ...extra,
  })
  return { provider, requests, fetchImpl }
}

/* ── auth / signature ─────────────────────────────────────────────────── */

test('signature: HMAC-SHA256(secretKey, timestamp+requestId+accessCode+body)', async () => {
  const routes = { '/package/list': async () => CATALOG }
  const { requests, provider } = makeProvider(routes)
  await provider.catalog()
  const req = requests[0]
  assert.equal(req.headers['RT-AccessCode'], ACCESS)
  const expect = crypto
    .createHmac('sha256', SECRET)
    .update(req.headers['RT-Timestamp'] + req.headers['RT-RequestID'] + ACCESS + JSON.stringify(req.body))
    .digest('hex')
    .toLowerCase()
  assert.equal(req.headers['RT-Signature'], expect)
})

test('signature: ESIMA_SIGN_KEY=accesscode variant uses accessCode as HMAC key', async () => {
  process.env.ESIMA_SIGN_KEY = 'accesscode'
  try {
    const routes = { '/package/list': async () => CATALOG }
    const { requests, provider } = makeProvider(routes)
    await provider.catalog()
    const req = requests[0]
    const expect = crypto
      .createHmac('sha256', ACCESS)
      .update(req.headers['RT-Timestamp'] + req.headers['RT-RequestID'] + ACCESS + JSON.stringify(req.body))
      .digest('hex')
      .toLowerCase()
    assert.equal(req.headers['RT-Signature'], expect)
  } finally {
    delete process.env.ESIMA_SIGN_KEY
  }
})

/* ── normalization quirks ─────────────────────────────────────────────── */

test('prices: API value / 10000 → USD', async () => {
  const { provider } = makeProvider({ '/package/list': async () => CATALOG })
  const catalog = await provider.catalog()
  assert.equal(catalog.find((p) => p.packageCode === 'US_5_30').costUSD, 13.0)
  assert.equal(catalog.find((p) => p.packageCode === 'EU_10_30').costUSD, 15.99)
})

test('volumes: bytes → GB; <=0 → unlimited sentinel -1', async () => {
  assert.equal(bytesToGB(5368709120), 5)
  assert.equal(bytesToGB(536870912), 0.5)
  assert.equal(bytesToGB(10737418240), 10)
  assert.equal(bytesToGB(0), -1)
  assert.equal(bytesToGB(-1), -1)
})

test('time: "+0000" offset parsed to epoch ms', () => {
  assert.equal(parseApiTime('2026-10-07T21:13:01+0000'), Date.parse('2026-10-07T21:13:01+00:00'))
  assert.equal(parseApiTime(null), null)
})

/* ── rate limit + backoff ─────────────────────────────────────────────── */

test('rate limiter: burst of 8 immediate, then paced', async () => {
  const { createRateLimiter } = rateLimit
  const limiter = createRateLimiter({ capacity: 8, refillPerSec: 8 })
  const start = Date.now()
  await Promise.all(Array.from({ length: 8 }, () => limiter.acquire()))
  const burstMs = Date.now() - start
  assert.ok(burstMs < 50, `burst should be immediate, took ${burstMs}ms`)
  await limiter.acquire() // 9th waits ~125ms
  const pacedMs = Date.now() - start
  assert.ok(pacedMs >= 100, `9th acquire should pace ≥100ms, took ${pacedMs}ms`)
})

test('backoff: retryable error retried with growing delays, then succeeds', async () => {
  const delays = []
  let attempts = 0
  const out = await rateLimit.withBackoff(
    async () => {
      attempts++
      if (attempts < 3) throw new rateLimit.RetryableError('429', 429)
      return 'ok'
    },
    { sleep: async (ms) => delays.push(Math.round(ms)), baseDelayMs: 100, jitter: false },
  )
  assert.equal(out, 'ok')
  assert.equal(attempts, 3)
  assert.deepEqual(delays, [100, 200])
})

test('backoff: permanent error fails fast without retry', async () => {
  let attempts = 0
  await assert.rejects(() =>
    rateLimit.withBackoff(
      async () => {
        attempts++
        throw new Error('esiaccess_401001: auth failed')
      },
      { sleep: async () => {} },
    ),
  )
  assert.equal(attempts, 1)
})

test('adapter: HTTP 429 then 200 is retried transparently', async () => {
  let calls = 0
  const fetchImpl = async () => {
    calls++
    return calls === 1 ? jsonRes({}, 429) : jsonRes({ success: true, obj: CATALOG })
  }
  const provider = createEsimAccessProvider({ fetchImpl, sleepFn: NO_SLEEP, accessCode: ACCESS, secretKey: SECRET })
  const catalog = await provider.catalog()
  assert.equal(calls, 2)
  assert.equal(catalog.length, 5)
})

test('adapter: business error (success:false) fails without retry', async () => {
  let calls = 0
  const fetchImpl = async () => {
    calls++
    return jsonRes({ success: false, errorCode: '401001', errorMsg: 'Authentication failed' })
  }
  const provider = createEsimAccessProvider({ fetchImpl, sleepFn: NO_SLEEP, accessCode: ACCESS, secretKey: SECRET })
  await assert.rejects(() => provider.catalog(), /401001/)
  assert.equal(calls, 1)
})

/* ── plan resolution / coverage ───────────────────────────────────────── */

test('resolvePackage: country data plan strict-matches location+GB+days', async () => {
  const { provider } = makeProvider({ '/package/list': async () => CATALOG })
  assert.equal((await provider.resolvePackage('germany-5gb-30d'))?.packageCode, 'DE_5_30')
  assert.equal((await provider.resolvePackage('united-states-5gb-30d'))?.packageCode, 'US_5_30')
})

test('resolvePackage: unfulfillable plan returns null (coverage filter)', async () => {
  const { provider } = makeProvider({ '/package/list': async () => CATALOG })
  // germany has no 10GB package → cannot fulfil → null → "Coming soon"
  assert.equal(await provider.resolvePackage('germany-10gb-30d'), null)
  // france not in catalog at all
  assert.equal(await provider.resolvePackage('france-unl-7d'), null)
})

test('resolvePackage: unlimited plan matches volume<=0 by days', async () => {
  const { provider } = makeProvider({ '/package/list': async () => CATALOG })
  assert.equal((await provider.resolvePackage('germany-unl-7d'))?.packageCode, 'DE_UNL_7')
})

test('resolvePackage: regional bundle via candidate location codes', async () => {
  const { provider } = makeProvider({ '/package/list': async () => CATALOG })
  assert.equal((await provider.resolvePackage('europe-10gb'))?.packageCode, 'EU_10_30')
})

test('resolvePackage: per-plan env override wins; missing from catalog → null', async () => {
  process.env.ESIMA_PKG_GERMANY_10GB_30D = 'EU_10_30'
  try {
    const { provider } = makeProvider({ '/package/list': async () => CATALOG })
    assert.equal((await provider.resolvePackage('germany-10gb-30d'))?.packageCode, 'EU_10_30')
    process.env.ESIMA_PKG_GERMANY_10GB_30D = 'XX_MISSING_99'
    assert.equal(await provider.resolvePackage('germany-10gb-30d'), null)
  } finally {
    delete process.env.ESIMA_PKG_GERMANY_10GB_30D
  }
})

test('catalog: cached for TTL — one API call for repeated resolves', async () => {
  let calls = 0
  const { provider } = makeProvider({ '/package/list': async () => { calls++; return CATALOG } })
  await provider.resolvePackage('germany-5gb-30d')
  await provider.resolvePackage('germany-unl-7d')
  await provider.resolvePackage('united-states-5gb-30d')
  assert.equal(calls, 1)
})

test('unconfigured provider throws not_configured (coverage=unknown upstream)', async () => {
  const provider = createEsimAccessProvider({ fetchImpl: async () => { throw new Error('should not be called') } })
  await assert.rejects(() => provider.catalog(), /esiaccess_not_configured/)
})

/* ── order lifecycle (esimTranNo preferred everywhere) ────────────────── */

const ORDER = { orderNo: 'B26041021130002' }
const ESIM = {
  esimTranNo: '26041021130002',
  orderNo: 'B26041021130002',
  iccid: '89852240810733629810',
  qrCodeUrl: 'https://p.qrsim.net/x.png',
  shortUrl: 'https://p.qrsim.net/x',
  smdpStatus: 'RELEASED',
  esimStatus: 'GOT_RESOURCE',
  expiredTime: '2026-10-07T21:13:01+0000',
  totalVolume: 5368709120,
}

function lifecycleRoutes(overrides = {}) {
  return {
    '/package/list': async () => CATALOG,
    '/esim/order': async (body) => {
      assert.ok(body.transactionId.length > 0 && body.transactionId.length <= 64)
      assert.deepEqual(body.packageInfoList[0].packageCode, 'DE_5_30')
      return ORDER
    },
    '/esim/query': async (body) => {
      assert.equal(body.orderNo, ORDER.orderNo)
      assert.equal(body.pager.pageNum, 1)
      return { esimList: [ESIM], pager: { pageSize: 5, pageNum: 1, total: 1 } }
    },
    '/esim/usage/query': async (body) => {
      assert.deepEqual(body.esimTranNoList, ['26041021130002']) // esimTranNo, NOT iccid
      return { usageList: [{ esimTranNo: '26041021130002', orderUsage: 104857600, totalVolume: 5368709120, esimStatus: 'IN_USE' }] }
    },
    '/esim/topup': async (body) => {
      assert.equal(body.esimTranNo, '26041021130002')
      assert.equal(body.iccid, '')
      assert.equal(body.packageCode, 'DE_5_30')
      return { orderNo: 'T26041021130099' }
    },
    '/esim/cancel': async () => ({ success: true }),
    '/webhook/save': async (body) => ({ saved: body.webhookUrl }),
    '/webhook/query': async () => ({ webhook: 'https://jumesim.com/api/webhooks/esimaccess' }),
    ...overrides,
  }
}

test('createOrder: orderNo returned, payload null (async provisioning)', async () => {
  const { provider } = makeProvider(lifecycleRoutes())
  const r = await provider.createOrder({ planId: 'germany-5gb-30d', email: 't@example.com', reference: 'jum_web_TEST' })
  assert.equal(r.providerOrderNo, 'B26041021130002')
  assert.equal(r.payload, null)
})

test('installPayload: profiles queried by orderNo; esimTranNo primary; quirks normalized', async () => {
  const { provider } = makeProvider(lifecycleRoutes())
  const p = await provider.installPayload('B26041021130002')
  assert.equal(p.esimTranNo, '26041021130002') // NOT the iccid
  assert.equal(p.iccid, '89852240810733629810')
  assert.equal(p.qrUrl, 'https://p.qrsim.net/x.png')
  assert.equal(p.status, 'got_resource')
  assert.equal(p.expiresAt, Date.parse('2026-10-07T21:13:01+00:00'))
  assert.equal(p.totalBytes, 5368709120)
})

test('installPayload: still-provisioning eSIM returns null (no iccid/qr yet)', async () => {
  const { provider } = makeProvider(lifecycleRoutes({
    '/esim/query': async () => ({ esimList: [{ orderNo: ORDER.orderNo, smdpStatus: 'PENDING' }], pager: { total: 1 } }),
  }))
  assert.equal(await provider.installPayload('B26041021130002'), null)
})

test('usage: keyed by esimTranNo, defensive field parsing', async () => {
  const { provider } = makeProvider(lifecycleRoutes())
  const u = await provider.usage('26041021130002')
  assert.equal(u.usedBytes, 104857600)
  assert.equal(u.totalBytes, 5368709120)
  assert.equal(u.status, 'in_use')
})

test('topUp: esimTranNo + empty iccid + resolved packageCode', async () => {
  const { provider } = makeProvider(lifecycleRoutes())
  const r = await provider.topUp({ esimTranNo: '26041021130002', planId: 'germany-5gb-30d', reference: 'jum_top_TEST' })
  assert.equal(r.ok, true)
  assert.equal(r.providerOrderNo, 'T26041021130099')
})

test('cancel: success → ok; already-activated business error → ok:false (no throw)', async () => {
  const { provider } = makeProvider(lifecycleRoutes())
  assert.deepEqual(await provider.cancel('26041021130002'), { ok: true })

  const { provider: p2 } = makeProvider(lifecycleRoutes({
    '/esim/cancel': async () => new Error('esiaccess_200002'),
  }))
  assert.deepEqual(await p2.cancel('26041021130002'), { ok: false })
})

test('registerWebhook: saves URL and verifies by querying back', async () => {
  const { provider, requests } = makeProvider(lifecycleRoutes())
  const r = await provider.registerWebhook('https://jumesim.com/api/webhooks/esimaccess')
  assert.equal(r.ok, true)
  assert.equal(r.current, 'https://jumesim.com/api/webhooks/esimaccess')
  const save = requests.find((q) => q.endpoint === '/webhook/save')
  assert.equal(save.body.webhookUrl, 'https://jumesim.com/api/webhooks/esimaccess')
})

test('end-to-end scripted flow: catalog→order→payload→usage→topup→cancel', async () => {
  const { provider } = makeProvider(lifecycleRoutes())
  const pkg = await provider.resolvePackage('germany-5gb-30d')
  assert.ok(pkg)
  const order = await provider.createOrder({ planId: 'germany-5gb-30d', email: 't@example.com', reference: 'jum_e2e_1' })
  const payload = await provider.installPayload(order.providerOrderNo)
  assert.ok(payload.esimTranNo)
  const usage = await provider.usage(payload.esimTranNo)
  assert.ok(usage.totalBytes > 0)
  assert.equal((await provider.topUp({ esimTranNo: payload.esimTranNo, planId: 'germany-5gb-30d', reference: 'jum_e2e_top' })).ok, true)
  assert.equal((await provider.cancel(payload.esimTranNo)).ok, true)
})

/* ── provider selection flip ──────────────────────────────────────────── */

test('PROVIDER env flip: esimaccess default, esimg honored, zero other changes', async () => {
  const registryPath = `/tmp/esim-registry-${process.pid}.mjs`
  await build({
    entryPoints: [fileURLToPath(new URL('../api/providers/index.ts', import.meta.url))],
    bundle: true, platform: 'node', format: 'esm', target: 'node18',
    outfile: registryPath, logLevel: 'silent',
  })
  const registry = await import(registryPath)

  const saved = process.env.PROVIDER
  try {
    delete process.env.PROVIDER
    registry.__resetProviderForTests()
    assert.equal(registry.activeProviderName(), 'esimaccess')
    assert.equal(registry.getProvider().name, 'esimaccess')

    process.env.PROVIDER = 'esimg'
    registry.__resetProviderForTests()
    assert.equal(registry.activeProviderName(), 'esimg')
    assert.equal(registry.getProvider().name, 'esimg')

    process.env.PROVIDER = 'esim-go' // tolerated alias
    registry.__resetProviderForTests()
    assert.equal(registry.getProvider().name, 'esimg')

    process.env.PROVIDER = 'garbage'
    registry.__resetProviderForTests()
    assert.equal(registry.getProvider().name, 'esimaccess') // unknown → default
  } finally {
    if (saved === undefined) delete process.env.PROVIDER
    else process.env.PROVIDER = saved
    registry.__resetProviderForTests()
  }
})
