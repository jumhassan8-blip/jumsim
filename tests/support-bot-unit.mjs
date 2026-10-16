#!/usr/bin/env node
/** Unit test for the client mock decision tree (src/lib/support-bot.ts).
 *  Bundles it with esbuild (deps: money, storage, support-context, config)
 *  and drives it through the spec flows. No browser, no backend.
 */
import { build } from 'esbuild'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'bot-'))
await build({
  entryPoints: ['tests/support-bot-entry.ts'],
  outfile: join(dir, 'bot.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  define: { 'import.meta.env': '{}' },
  logLevel: 'silent',
})
const mod = await import(join(dir, 'bot.mjs'))

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

const ctx = { orderId: 'ord_123', plan: 'Germany 5GB (Germany)', status: 'not_installed', country: 'Germany', checklistProgress: '2/6 steps', connectionTestResults: 'no test run yet' }

// greeting chips
const g = mod.greeting(ctx)
check('greeting labels AI assistant', g.text.includes('AI assistant'))
check('greeting mentions order', g.text.includes('ord_123'))
check('greeting has 5 chips', g.chips.length === 5)

let st = mod.initialBotState()
let out = mod.handleMessage(st, 'No internet connection', ctx)
st = out.state
check('internet steps numbered', /1\..*2\..*3\./s.test(out.reply.text))
check('did-this-fix-it ending', out.reply.text.includes('Did this fix it?'))

out = mod.handleMessage(st, 'No, more help', ctx)
st = out.state
check('first failure offers retry', !out.reply.escalate && st.attempts === 1)
out = mod.handleMessage(st, 'No, more help', ctx)
st = out.state
check('second failure escalates', out.reply.escalate === true && out.reply.text.includes('Connecting you to our team'))

out = mod.handleMessage(st, 'Connect me to a human', ctx)
check('explicit human request escalates', out.reply.escalate === true)

// refund guardrail
st = mod.initialBotState()
out = mod.handleMessage(st, 'Request a refund', ctx)
check('eligible refund gets confirmation card', out.reply.confirmation?.orderId === 'ord_123' && out.reply.confirmation.amountUSD === 6.99)
check('refund text explains window', out.reply.text.includes('never connected'))

const activeCtx = { ...ctx, status: 'active' }
out = mod.handleMessage(mod.initialBotState(), 'I want a refund', activeCtx)
check('activated order refused with policy', !out.reply.confirmation && out.reply.text.includes('activation'))

const noOrderCtx = { ...ctx, orderId: null, plan: null, status: null }
out = mod.handleMessage(mod.initialBotState(), 'refund please', noOrderCtx)
check('no order → email support, no card', !out.reply.confirmation && out.reply.text.includes('support@jumesim.com'))

// resolved flow
st = mod.initialBotState()
out = mod.handleMessage(st, "eSIM won't install", ctx)
out = mod.handleMessage(out.state, 'Yes', ctx)
check('yes marks resolved', out.reply.resolved === true)

// unknown question deflects, never invents
out = mod.handleMessage(mod.initialBotState(), "what's the weather like on mars?", ctx)
check('unknown deflects to human offer', out.reply.chips.some((c) => /human/i.test(c)))

console.log(`\n${pass}/${pass + fail} passed`)
process.exit(fail ? 1 : 0)
