/**
 * Jum Assistant — support chat screen.
 *
 * WhatsApp-style thread, dark theme, lime send button. Every message is
 * POSTed to /api/support/chat (LLM + kb.md server-side). If the backend is
 * unreachable, the thread says so honestly and offers the prefilled email
 * fallback — never a canned local bot, never a dead end.
 *
 * Guardrails (spec): refund executes ONLY via the confirmation card; after 2
 * failed fix attempts (or on request) → human escalation with transcript;
 * bot always labeled "AI assistant".
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { ArrowLeft, Mail, Send, ShieldAlert } from 'lucide-react'
import { CONFIG } from '../config'
import { track } from '../lib/analytics'
import { noteSupportActivity } from '../lib/rating'
import { buildOrderContext } from '../lib/support-context'
import { buildSupportMailto, buildTranscriptMailto } from '../lib/support-email'
import { formatUSD } from '../lib/money'
import { executeRefund } from '../lib/guarantee'
import { useStore } from '../state/StoreContext'

interface ThreadMessage {
  role: 'user' | 'bot'
  text: string
  at: number
  confirmation?: { orderId: string; amountUSD: number }
  escalate?: boolean
}

interface BotReply {
  text: string
  chips?: string[]
  confirmation?: { orderId: string; amountUSD: number }
  escalate?: boolean
}

interface ChatResponse {
  reply: BotReply
}

const GREETING_TEXT =
  "Hi, I'm the Jum Assistant. I can help with installs, connection issues, orders and refunds. What's going on?"
const GREETING_CHIPS = ['Check my order', 'eSIM installation help', 'No internet connection', 'Refund question']

export default function SupportChat() {
  const { markServerRefunded } = useStore()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const orderIdParam = params.get('orderId')

  const ctx = useMemo(() => buildOrderContext(orderIdParam), [orderIdParam])

  const [messages, setMessages] = useState<ThreadMessage[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [backendDown, setBackendDown] = useState(false)
  const [lastChips, setLastChips] = useState<string[] | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const greetedRef = useRef(false)

  useEffect(() => {
    track('chat_opened', { orderId: ctx.orderId ?? '' })
  }, [ctx.orderId])

  useEffect(() => {
    if (greetedRef.current) return
    greetedRef.current = true
    setMessages([{ role: 'bot', text: GREETING_TEXT, at: Date.now() }])
    setLastChips(GREETING_CHIPS)
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, busy])

  async function postToBackend(text: string, history: ThreadMessage[]): Promise<BotReply> {
    const res = await fetch(`${CONFIG.apiUrl}/api/support/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: text,
        history: history.slice(-20).map((m) => ({ role: m.role, text: m.text })),
        orderContext: ctx,
      }),
    })
    if (!res.ok) throw new Error(`support_chat_http_${res.status}`)
    const data = (await res.json()) as ChatResponse
    return data.reply
  }

  async function send(text: string) {
    const trimmed = text.trim()
    if (!trimmed || busy) return
    const userMsg: ThreadMessage = { role: 'user', text: trimmed, at: Date.now() }
    setMessages((m) => [...m, userMsg])
    setInput('')
    setBusy(true)
    track('chat_message_sent', { orderId: ctx.orderId ?? '' })
    // a live support conversation suppresses the post-purchase rating prompt
    noteSupportActivity()

    try {
      let reply: BotReply
      try {
        reply = await postToBackend(trimmed, messages)
      } catch (err) {
        console.error('[support] chat backend unreachable:', err)
        setBackendDown(true)
        reply = {
          text: "I couldn't reach the support server. You can keep trying, or email us — your details are pre-filled.",
        }
      }

      if (reply.escalate) track('bot_escalated_human', { orderId: ctx.orderId ?? '' })

      setMessages((m) => [
        ...m,
        {
          role: 'bot',
          text: reply.text,
          at: Date.now(),
          confirmation: reply.confirmation,
          escalate: reply.escalate,
        },
      ])
      setLastChips(reply.chips ?? null)
    } finally {
      setBusy(false)
    }
  }

  // Refund via chat runs the SAME server sequence as the in-app button:
  // verify unused → terminate at the supplier → only then Stripe refunds.
  async function runConfirmedRefund(orderId: string) {
    track('refund_confirmed_via_chat', { orderId })
    setMessages((m) => [
      ...m.filter((x) => !(x.role === 'bot' && x.confirmation?.orderId === orderId)),
      { role: 'bot', text: 'Checking your eSIM and cancelling it at the supplier…', at: Date.now() },
    ])
    try {
      const r = await executeRefund(orderId)
      if (r.ok) {
        markServerRefunded(orderId)
        setMessages((m) => [
          ...m,
          {
            role: 'bot',
            text: 'Done — your eSIM is permanently cancelled (even a screenshot of its code no longer works) and your refund is on its way back to your original payment method (5–10 business days). Anything else?',
            at: Date.now(),
          },
        ])
      } else if (r.reason === 'in_use') {
        setMessages((m) => [
          ...m,
          {
            role: 'bot',
            text: 'This eSIM has already been used, so the money-back guarantee no longer applies — but I can still help you get it working. What exactly happens when you try to connect?',
            at: Date.now(),
          },
        ])
      } else if (r.reason === 'window_expired') {
        setMessages((m) => [
          ...m,
          {
            role: 'bot',
            text: 'The 10-minute money-back window has closed. If something is genuinely wrong, email support@jumesim.com with your order ID and we will sort it out.',
            at: Date.now(),
          },
        ])
      } else {
        // cant_terminate / stripe_failed / refund_in_progress — a human owns it now
        setMessages((m) => [
          ...m,
          {
            role: 'bot',
            text: "I couldn't complete the refund automatically — our team has been alerted and will handle it within 24h. You can also email support@jumesim.com with your order ID.",
            at: Date.now(),
          },
        ])
      }
      setLastChips(["eSIM won't install", 'No internet connection', 'Check my order', 'Something else'])
    } catch (err) {
      console.error('[support] refund failed:', err)
      setMessages((m) => [
        ...m,
        {
          role: 'bot',
          text: "I couldn't reach the refund service — email support@jumesim.com with your order ID and we'll sort it within 24h.",
          at: Date.now(),
        },
      ])
      setLastChips(['Email support'])
    }
  }

  const transcriptMailto = () =>
    buildTranscriptMailto(
      buildOrderContext(orderIdParam),
      messages.map((m) => ({ role: m.role, text: m.text })),
    )

  return (
    <div className="flex min-h-dvh flex-col bg-[#0A0A0A]">
      <header className="sticky top-0 z-40 border-b border-[#2A2A2C] bg-[#0A0A0A]/90 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-2 px-4">
          <button
            onClick={() => navigate(-1)}
            aria-label="Back"
            className="flex h-11 w-11 items-center justify-center rounded-full text-white transition-colors active:bg-[#2C2C2E]"
          >
            <ArrowLeft size={22} />
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-white">{CONFIG.support.assistantName}</p>
            <p className="flex items-center gap-1 text-[11px] text-[#9A9A9E]">
              <ShieldAlert size={11} className="text-[#D7FF3F]" /> AI assistant · replies instantly
            </p>
          </div>
          <a
            href={buildSupportMailto(orderIdParam)}
            aria-label="Email support"
            className="flex h-11 w-11 items-center justify-center rounded-full text-[#9A9A9E] transition-colors active:bg-[#2C2C2E]"
          >
            <Mail size={18} />
          </a>
        </div>
      </header>

      {backendDown && (
        <div className="border-b border-[#FF9F0A]/40 bg-[#FF9F0A]/10 px-4 py-2 text-center text-xs text-[#FF9F0A]">
          Support server unreachable — chat may be limited.{' '}
          <a href={buildSupportMailto(orderIdParam)} className="font-semibold underline">
            Email us instead
          </a>
        </div>
      )}

      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-4 py-4">
        <div className="flex flex-1 flex-col gap-2.5 pb-4">
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[85%] whitespace-pre-line rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                  m.role === 'user'
                    ? 'rounded-br-md bg-[#D7FF3F] text-[#0A0A0A]'
                    : 'rounded-bl-md bg-[#1C1C1E] text-[#E5E5EA]'
                }`}
              >
                {m.text}
                {m.confirmation && (
                  <div className="mt-3 rounded-xl border border-[#2A2A2C] bg-[#0A0A0A] p-3">
                    <p className="text-sm font-semibold text-white">
                      Refund {formatUSD(m.confirmation.amountUSD)} to your card?
                    </p>
                    <p className="mt-0.5 text-xs text-[#9A9A9E]">
                      Returns to your original payment method in 5–10 business days.
                    </p>
                    <div className="mt-3 flex gap-2">
                      <button
                        onClick={() => void runConfirmedRefund(m.confirmation!.orderId)}
                        className="flex-1 rounded-lg bg-[#D7FF3F] py-2 text-sm font-semibold text-[#0A0A0A]"
                      >
                        Confirm
                      </button>
                      <button
                        onClick={() =>
                          setMessages((prev) =>
                            prev.filter((x) => !(x.role === 'bot' && x.confirmation?.orderId === m.confirmation!.orderId)),
                          )
                        }
                        className="flex-1 rounded-lg bg-[#2C2C2E] py-2 text-sm font-semibold text-white"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
                {m.escalate && (
                  <a
                    href={transcriptMailto()}
                    className="mt-2 flex items-center justify-center gap-2 rounded-lg bg-[#2C2C2E] px-3 py-2 text-xs font-semibold text-[#D7FF3F]"
                  >
                    <Mail size={13} /> Email my transcript
                  </a>
                )}
              </div>
            </div>
          ))}
          {busy && (
            <div className="flex justify-start">
              <div className="rounded-2xl rounded-bl-md bg-[#1C1C1E] px-4 py-3 text-sm text-[#9A9A9E]">
                <span className="animate-pulse">…</span>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {lastChips && lastChips.length > 0 && !busy && (
          <div className="flex flex-wrap gap-2 pb-3">
            {lastChips.map((chip) => (
              <button
                key={chip}
                onClick={() => void send(chip)}
                className="rounded-full border border-[#D7FF3F]/40 bg-[#D7FF3F]/10 px-3.5 py-1.5 text-xs font-medium text-[#D7FF3F]"
              >
                {chip}
              </button>
            ))}
          </div>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault()
            void send(input)
          }}
          className="sticky bottom-0 flex items-center gap-2 border-t border-[#2A2A2C] bg-[#0A0A0A] py-3"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type a message…"
            aria-label="Message"
            className="min-h-[44px] flex-1 rounded-full bg-[#1C1C1E] px-4 text-sm text-white placeholder-[#6C6C70] outline-none focus:ring-1 focus:ring-[#D7FF3F]/50"
          />
          <button
            type="submit"
            disabled={!input.trim() || busy}
            aria-label="Send"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#D7FF3F] text-[#0A0A0A] disabled:opacity-40"
          >
            <Send size={18} />
          </button>
        </form>
      </main>
    </div>
  )
}
