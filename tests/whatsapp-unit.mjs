#!/usr/bin/env node
/** Unit test for openWhatsApp (src/lib/whatsapp.ts): the native scheme is
 *  PRIMARY (whatsapp://send?phone=…), the wa.me https URL is the automatic
 *  fallback — canOpenURL false, canOpenURL rejecting, and no Linking at all
 *  (web build) must all land somewhere useful. Never a dead button.
 */
import { build } from 'esbuild'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'wa-'))
await build({
  entryPoints: ['tests/whatsapp-entry.ts'],
  outfile: join(dir, 'whatsapp.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  define: { 'import.meta.env': '{}' },
  logLevel: 'silent',
})
const { openWhatsApp, setWhatsAppLinking, whatsappAppUrl, whatsappWebUrl, harness } =
  await import(join(dir, 'whatsapp.mjs'))

let pass = 0
let fail = 0
const check = (name, ok, detail = '') => {
  if (!ok) fail++
  else pass++
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' — ' + detail}`)
}
const tick = () => new Promise((r) => setTimeout(r, 0))
const ctx = { orderId: 'ORD42', plan: '5GB · 7 days', country: 'Japan' }

// ── URL builders: single source, correct number in both forms ────────────
check(
  'app url uses whatsapp:// scheme + phone',
  whatsappAppUrl('hi') === 'whatsapp://send?phone=23233129788&text=hi',
  whatsappAppUrl('hi'),
)
check(
  'web url uses wa.me + text',
  whatsappWebUrl('hi') === 'https://wa.me/23233129788?text=hi',
  whatsappWebUrl('hi'),
)
check('order prefill embeds orderId/plan/country', (() => {
  const u = whatsappWebUrl(
    'Hi Jum e-SIM! I need help with my order ORD42 — 5GB · 7 days, Japan. My issue: ',
  )
  return u.includes(encodeURIComponent('ORD42'))
})())

// ── web build (no Linking injected): opens wa.me in a new tab ────────────
harness.opened.length = 0
const web = openWhatsApp('profile')
await tick()
check('web: returns wa.me url', web.startsWith('https://wa.me/23233129788?text='), web)
check('web: window.open got wa.me', harness.opened[0]?.startsWith('https://wa.me/23233129788'), harness.opened[0])

// ── native, WhatsApp installed: app scheme opens directly ────────────────
const calls = []
setWhatsAppLinking({
  canOpenURL: async (url) => {
    calls.push(['canOpenURL', url])
    return url.startsWith('whatsapp://')
  },
  openURL: async (url) => void calls.push(['openURL', url]),
})
const app = openWhatsApp('install_fail', ctx)
await tick()
check('native: returns app url', app.startsWith('whatsapp://send?phone=23233129788'), app)
check(
  'native installed: openURL(app scheme) — directly into the chat',
  calls.some(([k, u]) => k === 'openURL' && u.startsWith('whatsapp://send?phone=23233129788&text=')),
  JSON.stringify(calls),
)
check(
  'native: prefill encoded in the app url',
  decodeURIComponent(calls.find(([, u]) => u.startsWith('whatsapp://'))?.[1].split('text=')[1] ?? '').includes('ORD42'),
)

// ── native, NOT installed: falls back to the browser URL ─────────────────
calls.length = 0
setWhatsAppLinking({
  canOpenURL: async () => false,
  openURL: async (url) => void calls.push(['openURL', url]),
})
openWhatsApp('connection_fail')
await tick()
check(
  'native missing: openURL(wa.me) — Continue to Chat, no dead end',
  calls.some(([k, u]) => k === 'openURL' && u.startsWith('https://wa.me/23233129788')),
  JSON.stringify(calls),
)

// ── native, canOpenURL THROWS: logged + browser fallback, no crash ───────
calls.length = 0
harness.opened.length = 0
const errsBefore = harness.errors.length
setWhatsAppLinking({
  canOpenURL: async () => {
    throw new Error('query_failed')
  },
  openURL: async () => {},
})
let threw = false
try {
  openWhatsApp('checkout_fail')
  await tick()
} catch {
  threw = true
}
check('native canOpenURL rejects: does not throw', !threw)
check(
  'native canOpenURL rejects: error logged',
  harness.errors.length > errsBefore,
  `errors ${harness.errors.length} vs ${errsBefore}`,
)
check(
  'native canOpenURL rejects: falls back to wa.me',
  harness.opened.some((u) => u.startsWith('https://wa.me/23233129788')),
  JSON.stringify(harness.opened),
)

setWhatsAppLinking(null)
console.log(fail === 0 ? `\n${pass}/${pass + fail} passed` : `\nFAILED ${fail}`)
process.exit(fail === 0 ? 0 : 1)
