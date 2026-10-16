#!/usr/bin/env node
/** Unit test for the wallet visibility rule (src/lib/wallets.ts).
 *  Bundles the pure function with esbuild and drives every gating layer:
 *  config flags, preview env, device platform, SDK support.
 */
import { build } from 'esbuild'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'wallets-'))
await build({
  entryPoints: ['tests/wallets-entry.ts'],
  outfile: join(dir, 'wallets.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  define: { 'import.meta.env': '{}' },
  logLevel: 'silent',
})
const { visibleWallets } = await import(join(dir, 'wallets.mjs'))

let pass = 0
let fail = 0
const check = (name, ok, detail = '') => {
  if (ok) pass++
  else {
    fail++
    console.log(`FAIL ${name} ${detail}`)
  }
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`)
}

const both = { applePay: { enabled: true }, googlePay: { enabled: true } }
const none = { applePay: { enabled: false }, googlePay: { enabled: false } }

// ── acceptance: no wallet code runs when disabled in config ──────────────
check('disabled config → no rows (ios)', visibleWallets(none, 'ios-device', 'ios', { apple: true, google: true }).length === 0)
check('disabled config → no rows (android)', visibleWallets(none, 'android-device', 'android', { apple: true, google: true }).length === 0)
check('disabled config → no rows (preview)', visibleWallets(none, 'preview', 'ios', { apple: true, google: true }).length === 0)

// ── preview/web: both hidden even with SDK support ───────────────────────
check('preview hides Apple row', !visibleWallets(both, 'preview', 'ios', { apple: true, google: true }).includes('apple'))
check('preview hides Google row', !visibleWallets(both, 'preview', 'android', { apple: true, google: true }).includes('google'))

// ── device gating ─────────────────────────────────────────────────────────
check('ios-device + apple SDK → Apple row', visibleWallets(both, 'ios-device', 'ios', { apple: true, google: true }).join() === 'apple')
check('ios-device hides Google row', !visibleWallets(both, 'ios-device', 'ios', { apple: true, google: true }).includes('google'))
check('android-device + google SDK → Google row', visibleWallets(both, 'android-device', 'android', { apple: true, google: true }).join() === 'google')
check('android-device hides Apple row', !visibleWallets(both, 'android-device', 'android', { apple: true, google: true }).includes('apple'))
check('desktop device → no wallet rows', visibleWallets(both, 'ios-device', 'other', { apple: true, google: true }).length === 0)

// ── SDK gating: never show a wallet that will fail ───────────────────────
check('ios without SDK support → no Apple row', visibleWallets(both, 'ios-device', 'ios', { apple: false, google: false }).length === 0)
check('android without SDK support → no Google row', visibleWallets(both, 'android-device', 'android', { apple: false, google: false }).length === 0)

// ── partial config ────────────────────────────────────────────────────────
const appleOnly = { applePay: { enabled: true }, googlePay: { enabled: false } }
check('apple-only config on android → nothing', visibleWallets(appleOnly, 'android-device', 'android', { apple: true, google: true }).length === 0)
check('apple-only config on ios → Apple row', visibleWallets(appleOnly, 'ios-device', 'ios', { apple: true, google: true }).join() === 'apple')

console.log(`\n${pass}/${pass + fail} passed`)
process.exit(fail ? 1 : 0)
