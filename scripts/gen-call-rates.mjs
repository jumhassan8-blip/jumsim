#!/usr/bin/env node
/**
 * Generates src/data/call-rates.json — one entry per catalog country:
 *   { iso2, country, dialCode, mobilePerMin, landlinePerMin }
 *
 * Well-known destinations use curated rates (below); the rest get a
 * deterministic pseudo-random rate derived from the ISO code so the file is
 * stable across regenerations. Re-run after editing the catalog:
 *
 *   node scripts/gen-call-rates.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = new URL('../', import.meta.url)
const catalogSrc = readFileSync(new URL('src/data/catalog.ts', root), 'utf8')
const pricing = JSON.parse(readFileSync(new URL('public/pricing.json', root), 'utf8'))

/** parse the RAW ["Name","ISO"] pairs out of catalog.ts */
const entries = []
const re = /\['([^']+)',\s*'([A-Z]{2})'\]/g
let m
while ((m = re.exec(catalogSrc))) entries.push({ country: m[1], iso2: m[2] })

/** curated per-minute USD rates for common destinations */
const curated = {
  US: [0.03, 0.02], CA: [0.03, 0.02], GB: [0.04, 0.02], DE: [0.08, 0.03],
  FR: [0.08, 0.03], ES: [0.08, 0.03], IT: [0.08, 0.03], NL: [0.08, 0.03],
  JP: [0.09, 0.05], KR: [0.08, 0.04], CN: [0.10, 0.06], HK: [0.06, 0.03],
  SG: [0.06, 0.03], AU: [0.05, 0.03], TH: [0.09, 0.04], IN: [0.07, 0.04],
  BR: [0.12, 0.06], MX: [0.06, 0.03], AE: [0.12, 0.07], SA: [0.12, 0.07],
  ZA: [0.14, 0.08], KE: [0.16, 0.10], NG: [0.18, 0.11], EG: [0.15, 0.09],
}

/** FNV-1a — deterministic per-ISO jitter */
function hash(s) {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0) / 0xffffffff
}

const out = []
for (const { country, iso2 } of entries) {
  const dial = pricing.dialCodes[iso2]?.dialCode
  if (!dial) continue
  const [mobile, landline] = curated[iso2] ?? [
    Math.round((0.12 + hash(iso2) * 0.28) * 100) / 100,
    Math.round((0.06 + hash(iso2 + 'l') * 0.18) * 100) / 100,
  ]
  out.push({ iso2, country, dialCode: dial, mobilePerMin: mobile, landlinePerMin: landline })
}

out.sort((a, b) => a.country.localeCompare(b.country))
writeFileSync(
  new URL('src/data/call-rates.json', root),
  JSON.stringify(out, null, 1) + '\n',
)
console.log(`wrote ${out.length} call-rate entries`)
