#!/usr/bin/env node
/** Unit test for src/lib/rating.ts: eligibility rules (1/order, 90-day cap,
 *  rated flag, support gate, refunded order) + the store-review adapter
 *  (native handler injected, web fallback to jumesim.com/rate, handler
 *  failure falls back too). */
import { build } from 'esbuild'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'rating-'))
await build({
  entryPoints: ['tests/rating-entry.ts'],
  outfile: join(dir, 'rating.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  define: { 'import.meta.env': '{}' },
  logLevel: 'silent',
})
const {
  loadRatingState,
  isRatingPromptEligible,
  markPromptShown,
  markRated,
  markPromptDismissed,
  noteSupportActivity,
  ratingSupportPrefill,
  setStoreReviewHandler,
  requestStoreReview,
  RATING_PROMPT_COOLDOWN_MS,
  harness,
} = await import(join(dir, 'rating.mjs'))

let pass = 0
let fail = 0
const check = (name, ok, detail = '') => {
  if (!ok) fail++
  else pass++
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' — ' + detail}`)
}

// ── default state ─────────────────────────────────────────────────────────
const fresh = loadRatingState()
check('default state: not rated, empty perOrder, no caps', !fresh.rated && Object.keys(fresh.perOrder).length === 0 && fresh.lastPromptAt === 0 && fresh.supportActiveUntil === 0)

check('fresh state: order eligible', isRatingPromptEligible('ord_A'))

// ── 1 prompt per purchased eSIM ───────────────────────────────────────────
markPromptShown('ord_A')
check('after show: same order NOT eligible', !isRatingPromptEligible('ord_A'))
check('after show: a DIFFERENT order still eligible (no dismissal yet)', isRatingPromptEligible('ord_B'))

// ── 90-day global cap anchors at DISMISSAL ────────────────────────────────
markPromptDismissed()
check('after dismissal: any order NOT eligible', !isRatingPromptEligible('ord_B'))
check('after dismissal: order NOT eligible even if never prompted', !isRatingPromptEligible('ord_C'))

// simulate 91 days passing
const st = loadRatingState()
st.lastPromptAt = Date.now() - RATING_PROMPT_COOLDOWN_MS - 60_000
save(st)
check('91 days after dismissal: eligible again', isRatingPromptEligible('ord_C'))

// ── rated flag ────────────────────────────────────────────────────────────
markRated()
check('after rating: never eligible again', !isRatingPromptEligible('ord_D'))
check('rated flag persisted', loadRatingState().rated === true)

// ── support gate ──────────────────────────────────────────────────────────
function save(state) {
  // re-export through the module's own saver via localStorage round-trip
  harness.store.set('jum-esim:rating:v1', JSON.stringify(state))
}
noteSupportActivity()
check('during support conversation: NOT eligible', !isRatingPromptEligible('ord_E'))

// ── refunded order ────────────────────────────────────────────────────────
{
  const s = loadRatingState()
  s.supportActiveUntil = 0
  s.rated = false // isolate this gate from the rated-flag check above
  save(s)
}
check('refunded order: NOT eligible', !isRatingPromptEligible('ord_F', true))
check('same order, not refunded: eligible', isRatingPromptEligible('ord_F'))

// ── low-rating prefill ────────────────────────────────────────────────────
check(
  'prefill names the star count',
  ratingSupportPrefill(2) === 'Hi! I rated my experience 2 stars because… ',
  ratingSupportPrefill(2),
)

// ── store-review adapter ──────────────────────────────────────────────────
harness.opened.length = 0
let requested = 0
setStoreReviewHandler({ requestReview: () => void requested++ })
const url = requestStoreReview()
check('native handler: requestReview() invoked', requested === 1)
check('native handler: returns the rate URL for testability', url === 'https://jumesim.com/rate')

setStoreReviewHandler(null)
requestStoreReview()
check('web fallback: opens jumesim.com/rate', harness.opened.includes('https://jumesim.com/rate'))

harness.opened.length = 0
setStoreReviewHandler({
  requestReview: () => {
    throw new Error('no store on this device')
  },
})
await Promise.resolve()
requestStoreReview()
await new Promise((r) => setTimeout(r, 0))
check(
  'handler failure: falls back to the rate page, never a dead end',
  harness.opened.includes('https://jumesim.com/rate'),
  JSON.stringify(harness.opened),
)
setStoreReviewHandler(null)

console.log()
console.log(fail === 0 ? `RATING UNIT: ALL ${pass} PASS` : `RATING UNIT: ${fail} FAILURES`)
process.exit(fail === 0 ? 0 : 1)
