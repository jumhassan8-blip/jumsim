/**
 * POST /api/support/chat — "Jum Assistant" backend.
 *
 * Body: { message, history: [{role, text}], orderContext: {...} }
 * Reply: { reply: { text, chips?, confirmation?, escalate? } }
 *
 * Two modes:
 *  - MOCK_MODE=true or no OPENAI_API_KEY → canned decision tree (same flows
 *    as the client mock bot; refunds still need the confirmation card).
 *  - Live → OpenAI-compatible chat completion with the kb.md system prompt.
 *    The LLM can never execute a refund: to offer one it must emit the marker
 *    [[REFUND_CONFIRM orderId=… amount=…]] which becomes a confirmation card
 *    on the client; only an explicit user tap on Confirm calls /api/refund.
 */
import { readFileSync } from 'node:fs'
import { withApi, sendJson } from '../lib/http'
import { getOrder, isMockMode } from '../lib/orders'
import { authoritativePrice } from '../lib/pricing'

interface OrderContext {
  orderId?: string | null
  plan?: string | null
  status?: string | null
  country?: string | null
  checklistProgress?: string | null
  connectionTestResults?: string | null
}

interface BotReply {
  text: string
  chips?: string[]
  confirmation?: { orderId: string; amountUSD: number }
  escalate?: boolean
}

const FALLBACK_KB = `Jum e-SIM support facts: refunds — full refund within 14 days if the eSIM never connected; no refund after activation (law aside); failed installs (never connected) refunded even past the window; 5–10 business days to original payment method; support@jumesim.com replies within 24h. Plans activate on first network connection; unlimited = 2.5 GB/day full speed then 512 kbps. Install: iPhone Settings → Cellular → Add eSIM; Android Settings → Network & internet → SIMs → Add eSIM. No connection: turn eSIM line on, data roaming on for the Jum line only, select it as data line, toggle airplane mode.`

/** kb.md travels with the function (vercel.json includeFiles / dev-api copy). */
function loadKb(): string {
  const candidates = ['../kb.md', '../../kb.md', './kb.md', '../../api/kb.md']
  for (const rel of candidates) {
    try {
      return readFileSync(new URL(rel, import.meta.url), 'utf8')
    } catch {
      /* try next */
    }
  }
  console.warn('[support/chat] kb.md not found next to function — using embedded fallback')
  return FALLBACK_KB
}

function systemPrompt(ctx: OrderContext): string {
  return `You are the Jum Assistant, the support chatbot for Jum e-SIM (global travel eSIM store). You are an AI assistant — if asked, say so; never pretend to be human.

KNOWLEDGE BASE (only source of truth — never invent coverage, prices, or policies; if unsure, say so and offer human support at support@jumesim.com):
${loadKb()}

GUARDRAILS (never violate):
- You may CHECK refund eligibility and explain the policy. To offer a refund, end your reply with the exact marker line:
  [[REFUND_CONFIRM orderId=<id> amount=<usd number>]]
  The app then shows the user a confirmation card; the refund executes ONLY if the user explicitly confirms. You can never execute a refund yourself.
- After 2 failed fix attempts for the same issue, or when the user asks for a human, reply with exactly "Connecting you to our team" as the first sentence, explain that the transcript + order context are emailed to support@jumesim.com and a human replies within 24h.
- Use the order context for SPECIFIC answers, never generic scripts.

ORDER CONTEXT (this user's device/order):
${JSON.stringify(ctx, null, 2)}

FORMATTING RULES:
- Numbered steps, one clear next action per reply.
- End each troubleshooting resolution with: Did this fix it? [Yes ✓ / No, more help]
- Plain text only (the app renders your text as-is).`
}

// ── canned tree (MOCK_MODE / no key) — mirrors src/lib/support-bot.ts ──────

/** a user message that means "the fix failed" (not the "No internet" chip) */
function isFailureMarker(t: string): boolean {
  const s = t.trim().toLowerCase()
  return (/^no\b/.test(s) && /more help|still|not fixed|didn|doesn/.test(s)) || /^no[.!]?$/.test(s)
}

function cannedReply(
  message: string,
  ctx: OrderContext,
  priorNoCount: number,
): BotReply {
  const t = message.toLowerCase()
  const orderId = ctx.orderId ?? null

  // escalation: explicit human request, transcript chip re-tap, or 2+ failed fixes
  if (/human|agent|person|email my transcript/.test(t) || priorNoCount >= 2) {
    return {
      text: `Connecting you to our team. I’ve emailed your transcript and order context to support@jumesim.com${orderId ? ` (order ${orderId})` : ''} — a human replies within 24h.`,
      escalate: true,
      chips: ['Email my transcript'],
    }
  }
  if (isFailureMarker(message) && priorNoCount === 1) {
    return {
      text: 'Sorry that didn’t do it — one more thing to try:\n1. Delete the eSIM profile and re-install it from your install screen (Settings → Cellular / SIMs → Jum eSIM → Remove, then Add eSIM again).\n2. Restart the phone after re-installing.\n\nDid this fix it?',
      chips: ['Yes ✓', 'No, more help'],
    }
  }

  if (/refund|money back|cancel/.test(t)) {
    if (!orderId) {
      return {
        text:
          'I can check refund eligibility for a specific order, but I don’t see one here. Email support@jumesim.com with your order ID (receipt email or Profile → My eSIMs) and we’ll sort it within 24h.',
        chips: ['Something else'],
      }
    }
    if (ctx.status === 'active') {
      return {
        text: `Order ${orderId} has connected to a network, so per the refund policy it isn’t refundable after activation (wholesale costs are incurred) — except where the law requires. I can troubleshoot the issue or connect you to a human.`,
        chips: ['No internet connection', 'Connect me to a human'],
      }
    }
    if (ctx.status === 'refunded') {
      return {
        text: `Order ${orderId} is already refunded — it returns to your original payment method in 5–10 business days. Anything else?`,
        chips: ['Check my order', 'Something else'],
      }
    }
    return {
      text: `Order ${orderId} (${ctx.plan ?? 'plan'}) has never connected, and it’s within the 14-day window — it’s eligible for a full refund. Confirm below and it goes back to your original payment method in 5–10 business days.`,
      confirmation: { orderId, amountUSD: 0 }, // resolved below from the stored order
      chips: ['Check my order', 'Something else'],
    }
  }

  if (/won'?t install|can'?t install|install|qr|lpa|add esim/.test(t)) {
    return {
      text: `Let’s get it installed:\n1. Get on a stable Wi-Fi connection.\n2. iPhone: Settings → Cellular → Add eSIM → scan the QR (or “Enter Details Manually” with the LPA string).\n3. Android: Settings → Network & internet → SIMs → Add eSIM (+) → scan the QR or enter the LPA string.\n4. “Unable to add eSIM”? Your device may be carrier-locked — tell me and I’ll check refund options.\n\nDid this fix it?`,
      chips: ['Yes ✓', 'No, more help'],
    }
  }

  if (/internet|no (data|signal|connection)|not working|roaming|apn|slow/.test(t)) {
    return {
      text: `No-connection checklist:\n1. Turn the Jum eSIM line ON (Settings → Cellular / SIMs).\n2. Turn Data Roaming ON for the Jum eSIM line only.\n3. Select the Jum eSIM as your mobile-data line.\n4. Toggle airplane mode off and on.\n5. APN usually auto-configures; if not, match Settings → Mobile Data → Jum eSIM → APN to the install screen, then restart.\n\nDid this fix it?`,
      chips: ['Yes ✓', 'No, more help'],
    }
  }

  if (/^yes/i.test(message.trim())) {
    return {
      text: 'Great — glad it’s working. Anything else I can help with?',
      chips: ['Check my order', 'Something else'],
    }
  }

  if (/order|status|charged|top ?up/.test(t)) {
    if (orderId && ctx.plan) {
      return {
        text: `Order ${orderId}: ${ctx.plan}. Status: ${ctx.status}. Checklist: ${ctx.checklistProgress ?? 'n/a'}; ${ctx.connectionTestResults ?? 'no test run yet'}. Plans start at first connection, not purchase. Need anything else on it?`,
        chips: ['eSIM won’t install', 'No internet connection', 'Request a refund'],
      }
    }
    return {
      text: 'I don’t see an order on this device. If you were charged, you’re never charged twice — orders reconcile within minutes. Otherwise email support@jumesim.com with your order ID.',
      chips: ['Something else'],
    }
  }

  return {
    text: 'I’m not sure I follow — I’m an AI assistant and don’t want to guess. I can help with installs, connection issues, orders, or refunds — or connect you to a human.',
    chips: ['eSIM won’t install', 'No internet connection', 'Check my order', 'Request a refund', 'Connect me to a human'],
  }
}

async function resolveConfirmationAmount(reply: BotReply): Promise<BotReply> {
  if (!reply.confirmation || reply.confirmation.amountUSD > 0) return reply
  const order = reply.confirmation.orderId ? await getOrder(reply.confirmation.orderId) : null
  const amount = order ? (authoritativePrice(order.planId).expected ?? 0) : 0
  return { ...reply, confirmation: { ...reply.confirmation, amountUSD: amount } }
}

// ── live LLM call ──────────────────────────────────────────────────────────

const REFUND_MARKER = /\[\[REFUND_CONFIRM orderId=([\w-]+) amount=([\d.]+)\]\]/

async function llmReply(
  message: string,
  history: Array<{ role: string; text: string }>,
  ctx: OrderContext,
): Promise<BotReply> {
  const apiKey = process.env.OPENAI_API_KEY as string
  const base = (process.env.OPENAI_BASE_URL as string | undefined) ?? 'https://api.openai.com/v1'
  const model = (process.env.OPENAI_MODEL as string | undefined) ?? 'gpt-4o-mini'

  const messages = [
    { role: 'system', content: systemPrompt(ctx) },
    ...history.slice(-20).map((m) => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text })),
    { role: 'user', content: message },
  ]

  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages, temperature: 0.3, max_tokens: 700 }),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`llm_http_${res.status}:${detail.slice(0, 200)}`)
  }
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
  let text = data.choices?.[0]?.message?.content?.trim() ?? ''
  if (!text) throw new Error('llm_empty_response')

  const reply: BotReply = { text }
  const marker = REFUND_MARKER.exec(text)
  if (marker) {
    reply.confirmation = { orderId: marker[1], amountUSD: Number(marker[2]) }
    reply.text = text.replace(REFUND_MARKER, '').trim()
  }
  if (/^connecting you to our team/i.test(reply.text)) reply.escalate = true
  return resolveConfirmationAmount(reply)
}

export default withApi(async (body, _req, res) => {
  const message = typeof body.message === 'string' ? body.message : ''
  if (!message.trim()) {
    sendJson(res, 400, { error: 'message_required' })
    return
  }
  const history = Array.isArray(body.history)
    ? (body.history as Array<{ role: string; text: string }>)
    : []
  const ctx = (body.orderContext ?? {}) as OrderContext

  let reply: BotReply
  if (isMockMode() || !process.env.OPENAI_API_KEY) {
    // failed-fix markers up to and including the current message ("No, more
    // help"). Protocol: `history` holds PRIOR messages only (the current
    // message arrives separately), so count every user message in history
    // plus the current one.
    const priorNoCount =
      history.filter((m) => m.role === 'user' && isFailureMarker(String(m.text))).length +
      (isFailureMarker(message) ? 1 : 0)
    reply = await resolveConfirmationAmount(cannedReply(message, ctx, priorNoCount))
  } else {
    reply = await llmReply(message, history, ctx)
  }
  sendJson(res, 200, { reply, meta: { mock: isMockMode() || !process.env.OPENAI_API_KEY } })
})
