/**
 * Email-app fallback for support.
 *
 * Used when the chat backend is unreachable: opens the user's mail client
 * pre-filled to support@jumesim.com with order ID, app version, OS/device,
 * plan, and the checklist/test history — so a human can pick the thread up
 * with full context. Never a dead end.
 */
import { CONFIG } from '../config'
import { buildOrderContext, deviceSummary, supportHistoryLines, type OrderContext } from './support-context'

export function buildSupportMailto(orderIdParam?: string | null): string {
  const ctx = buildOrderContext(orderIdParam)
  const subject = `Jum e-SIM support — Order #${ctx.orderId ?? 'unknown'}`

  const lines = [
    'Hi Jum support,',
    '',
    ctx.orderId ? `I'm writing about order ${ctx.orderId}.` : "I'm writing about a Jum e-SIM issue.",
    '',
    '(Describe your issue above this line)',
    '',
    '— automatic context —',
    `App version: ${CONFIG.version}`,
    `Device: ${deviceSummary()}`,
    `Plan: ${ctx.plan ?? 'none on this device'}`,
    `Order status: ${ctx.status ?? 'unknown'}`,
    `Checklist: ${ctx.checklistProgress ?? 'n/a'}`,
    `Connection tests: ${ctx.connectionTestResults ?? 'n/a'}`,
    'History:',
    ...supportHistoryLines(ctx.orderId).map((l) => `  ${l}`),
  ]

  return `mailto:${CONFIG.supportEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(
    lines.join('\n'),
  )}`
}

/**
 * Escalation handoff — transcript + order context emailed to support.
 * Used by the chat screen after "Connecting you to our team" (the user's
 * mail app sends it; the backend also emails directly and this is the
 * belt-and-braces copy).
 */
export function buildTranscriptMailto(
  ctx: OrderContext,
  transcript: Array<{ role: 'user' | 'bot'; text: string }>,
): string {
  const subject = `Jum e-SIM support — Order #${ctx.orderId ?? 'unknown'} (chat transcript)`
  const lines = [
    'Hi Jum support,',
    '',
    'The Jum Assistant escalated this chat to a human. Transcript below.',
    '',
    '— order context —',
    `Order: ${ctx.orderId ?? 'unknown'}`,
    `Plan: ${ctx.plan ?? 'none'}`,
    `Status: ${ctx.status ?? 'unknown'}`,
    `Checklist: ${ctx.checklistProgress ?? 'n/a'}`,
    `Connection tests: ${ctx.connectionTestResults ?? 'n/a'}`,
    `App version: ${CONFIG.version}`,
    `Device: ${deviceSummary()}`,
    '',
    '— transcript —',
    ...transcript.map((m) => `${m.role === 'user' ? 'Customer' : 'Jum Assistant'}: ${m.text}`),
  ]
  return `mailto:${CONFIG.supportEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(
    lines.join('\n'),
  )}`
}
