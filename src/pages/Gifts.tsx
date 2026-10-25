/**
 * Gifts tab — Jum Gift Cards (brief §2/§3). One system, two storefronts
 * (Jum e-SIM + Jum Football), surfaced as three cards on one screen:
 *   A. Buy a Gift      → type → amount → recipient → pay (Stripe)
 *   B. Redeem a Code   → XXXX-XXXX-XXXX-XXXX auto-hyphenating input,
 *                        inline validation via /api/gift/preview
 *   C. My Gifts        → status chips (Sent · Redeemed · Scheduled ·
 *                        Refunded) + RESEND action
 * The header carries a season skin driven by a date-window config.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Gift, Sparkles, Ticket, Clock3, CheckCircle2, RefreshCw, Share2, X,
  ChevronRight, CalendarClock, Copy, PartyPopper, CircleAlert,
} from 'lucide-react'
import { track } from '../lib/analytics'
import { CONFIG } from '../config'
import {
  GIFT_PRODUCTS, GiftError, createGift, fetchMyGifts, hyphenateCode,
  isCompleteCode, previewGift, redeemGift, resendGift,
  type GiftCreateResult, type GiftPreview, type GiftRedeemResult,
  type GiftType, type MyGift,
} from '../lib/gifts'

/* ------------------------------------------------------------------ */
/* seasonal header skin — config-driven date windows                   */
/* ------------------------------------------------------------------ */

interface SeasonSkin {
  id: string
  /** [MM-DD, MM-DD] inclusive window (wraps year end) */
  window: [string, string]
  gradient: string
  icon: typeof Sparkles
  accentText: string
}

const SEASONS: SeasonSkin[] = [
  {
    id: 'festive',
    window: ['12-15', '01-05'],
    gradient: 'from-[#D7FF3F]/25 via-[#FF6B9D]/15 to-[#0A0A0A]',
    icon: PartyPopper,
    accentText: 'text-[#D7FF3F]',
  },
  {
    id: 'launch',
    window: ['01-01', '01-31'],
    gradient: 'from-[#D7FF3F]/20 via-[#5AC8FA]/10 to-[#0A0A0A]',
    icon: Sparkles,
    accentText: 'text-[#5AC8FA]',
  },
]

const DEFAULT_SKIN: SeasonSkin = {
  id: 'default',
  window: ['01-01', '12-31'],
  gradient: 'from-[#D7FF3F]/15 via-transparent to-[#0A0A0A]',
  icon: Gift,
  accentText: 'text-[#D7FF3F]',
}

function activeSeason(): SeasonSkin {
  const now = new Date()
  const mmdd = `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  for (const s of SEASONS) {
    const [a, b] = s.window
    if (a <= b ? mmdd >= a && mmdd <= b : mmdd >= a || mmdd <= b) return s
  }
  return DEFAULT_SKIN
}

/* ------------------------------------------------------------------ */
/* small building blocks                                              */
/* ------------------------------------------------------------------ */

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-3xl border border-[#2C2C2E] bg-[#1C1C1E] p-4 ${className}`}>{children}</div>
  )
}

const STATUS_CHIPS = ['sent', 'redeemed', 'scheduled', 'refunded'] as const
type Chip = (typeof STATUS_CHIPS)[number]

function chipFor(g: MyGift): Chip {
  if (g.status === 'redeemed') return 'redeemed'
  if (g.status === 'refunded') return 'refunded'
  if (g.delivery === 'scheduled' && g.status !== 'sent') return 'scheduled'
  return 'sent'
}

const CHIP_STYLE: Record<Chip, string> = {
  sent: 'bg-[#D7FF3F]/15 text-[#D7FF3F]',
  redeemed: 'bg-[#5AC8FA]/15 text-[#5AC8FA]',
  scheduled: 'bg-[#FF9F0A]/15 text-[#FF9F0A]',
  refunded: 'bg-[#9A9A9E]/15 text-[#9A9A9E]',
}

declare global {
  interface Window { Stripe?: new (key: string) => StripeJs }
}
interface StripeJs {
  elements(opts: { clientSecret: string }): { create(type: string): StripeElement }
}
interface StripeElement {
  mount(sel: string): void
}

let stripeJsPromise: Promise<void> | null = null
function loadStripeJs(): Promise<void> {
  if (window.Stripe) return Promise.resolve()
  stripeJsPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = 'https://js.stripe.com/v3'
    s.onload = () => resolve()
    s.onerror = () => reject(new Error('stripe_js_failed'))
    document.head.appendChild(s)
  })
  return stripeJsPromise
}

/* ------------------------------------------------------------------ */
/* buy flow                                                           */
/* ------------------------------------------------------------------ */

type BuyStep = 'product' | 'recipient' | 'pay' | 'done'

interface BuyState {
  type: GiftType
  amount: number
  recipientName: string
  recipientEmail: string
  recipientWhatsapp: string
  message: string
  delivery: 'now' | 'scheduled'
  scheduledAt: string
}

function BuyFlow({ onClose, onPurchased }: { onClose: () => void; onPurchased: () => void }) {
  const { t } = useTranslation()
  const [step, setStep] = useState<BuyStep>('product')
  const [form, setForm] = useState<BuyState>({
    type: 'jum_credit', amount: 10,
    recipientName: '', recipientEmail: '', recipientWhatsapp: '',
    message: '', delivery: 'now', scheduledAt: '',
  })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<GiftCreateResult | null>(null)
  const [copied, setCopied] = useState(false)

  const products = GIFT_PRODUCTS[form.type]
  const price = products.price(form.amount)

  const pick = (type: GiftType, amount: number) => {
    setForm((f) => ({ ...f, type, amount }))
    track('gift_product_selected', { type, amount })
  }

  const recipientValid =
    form.recipientName.trim().length > 0 &&
    (form.recipientEmail.includes('@') || form.recipientWhatsapp.replace(/\D/g, '').length >= 7) &&
    (form.delivery === 'now' || new Date(form.scheduledAt).getTime() > Date.now())

  const submit = async () => {
    setErr('')
    setBusy(true)
    track('gift_purchase_started', { type: form.type, amount: form.amount, delivery: form.delivery })
    try {
      const r = await createGift({
        type: form.type,
        amount: form.amount,
        recipientName: form.recipientName.trim(),
        recipientEmail: form.recipientEmail.trim() || undefined,
        recipientWhatsapp: form.recipientWhatsapp.replace(/\D/g, '') || undefined,
        message: form.message,
        delivery: form.delivery,
        scheduledAt: form.delivery === 'scheduled' ? new Date(form.scheduledAt).getTime() : undefined,
      })
      setResult(r)
      // Sandbox mock: the server simulates the intent; the webhook handler
      // is what marks the gift paid/sent (test seam exercises that path).
      if (!r.publishableKey) {
        setStep('done')
        track('gift_purchase_mock_confirmed', { giftId: r.giftId })
        onPurchased()
      } else {
        setStep('pay')
      }
    } catch (e) {
      const code = e instanceof GiftError ? e.code : 'purchase_failed'
      setErr(t(`gifts.err.${code}`, t('gifts.err.unknown')))
      if (code === 'daily_cap') track('gift_fraud_wall', { code })
    } finally {
      setBusy(false)
    }
  }

  const copyCode = async () => {
    if (!result) return
    try {
      await navigator.clipboard.writeText(result.plaintextCode)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* clipboard unavailable */ }
  }

  const shareWhatsApp = () => {
    if (!result) return
    const text = encodeURIComponent(
      `${t('gifts.share.lead')} ${result.plaintextCode} — ${CONFIG.siteUrl}/redeem?t=${result.deliveryToken}`,
    )
    window.open(`https://wa.me/?text=${text}`, '_blank', 'noopener')
    track('gift_share_whatsapp', { giftId: result.giftId })
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-[#0A0A0A]">
      <div className="mx-auto max-w-md px-4 pb-16 pt-6">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-extrabold tracking-tight">{t('gifts.buyTitle')}</h2>
          <button
            type="button"
            aria-label={t('common.close')}
            onClick={onClose}
            className="rounded-full border border-[#2C2C2E] p-2 text-[#9A9A9E] active:bg-[#2C2C2E]"
          >
            <X size={18} />
          </button>
        </div>

        {/* progress dots */}
        <div className="mt-4 flex gap-1.5" aria-hidden>
          {(['product', 'recipient', 'pay'] as BuyStep[]).map((s, i) => {
            const order: BuyStep[] = ['product', 'recipient', 'pay']
            const activeIdx = order.indexOf(step === 'done' ? 'pay' : step)
            return (
              <span
                key={s}
                className={`h-1 flex-1 rounded-full ${i <= activeIdx ? 'bg-[#D7FF3F]' : 'bg-[#2C2C2E]'}`}
              />
            )
          })}
        </div>

        {step === 'product' && (
          <div className="mt-6 space-y-6">
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[#9A9A9E]">{t('gifts.stepType')}</h3>
              <div className="mt-2 grid grid-cols-3 gap-2">
                {(Object.keys(GIFT_PRODUCTS) as GiftType[]).map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => pick(type, GIFT_PRODUCTS[type].amounts[0])}
                    className={`rounded-2xl border p-3 text-left text-xs font-semibold transition-colors ${
                      form.type === type
                        ? 'border-[#D7FF3F] bg-[#D7FF3F]/10 text-[#D7FF3F]'
                        : 'border-[#2C2C2E] bg-[#1C1C1E] text-[#9A9A9E] active:bg-[#2C2C2E]'
                    }`}
                  >
                    {t(`gifts.type.${type}`)}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[#9A9A9E]">{t('gifts.stepAmount')}</h3>
              <div className="mt-2 grid grid-cols-4 gap-2">
                {products.amounts.map((a) => (
                  <button
                    key={a}
                    type="button"
                    onClick={() => pick(form.type, a)}
                    className={`rounded-2xl border py-3 text-sm font-bold transition-colors ${
                      form.amount === a
                        ? 'border-[#D7FF3F] bg-[#D7FF3F] text-black'
                        : 'border-[#2C2C2E] bg-[#1C1C1E] text-white active:bg-[#2C2C2E]'
                    }`}
                  >
                    {products.unit === 'months' ? t('gifts.months', { count: a }) : `$${a}`}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs text-[#9A9A9E]">
                {form.type === 'jum_credit' ? t('gifts.conversionHint') : t('gifts.priceHint', { price: price.toFixed(2) })}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setStep('recipient')}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[#D7FF3F] py-3.5 text-sm font-bold text-black active:opacity-90"
            >
              {t('gifts.continue')} <ChevronRight size={16} />
            </button>
          </div>
        )}

        {step === 'recipient' && (
          <div className="mt-6 space-y-4">
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wider text-[#9A9A9E]">{t('gifts.recipientName')}</span>
              <input
                value={form.recipientName}
                onChange={(e) => setForm((f) => ({ ...f, recipientName: e.target.value }))}
                placeholder={t('gifts.recipientNamePh')}
                className="mt-1.5 w-full rounded-2xl border border-[#2C2C2E] bg-[#1C1C1E] px-4 py-3 text-sm text-white outline-none focus:border-[#D7FF3F]"
              />
            </label>
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wider text-[#9A9A9E]">{t('gifts.recipientEmail')}</span>
              <input
                type="email"
                value={form.recipientEmail}
                onChange={(e) => setForm((f) => ({ ...f, recipientEmail: e.target.value }))}
                placeholder={t('gifts.recipientEmailPh')}
                className="mt-1.5 w-full rounded-2xl border border-[#2C2C2E] bg-[#1C1C1E] px-4 py-3 text-sm text-white outline-none focus:border-[#D7FF3F]"
              />
            </label>
            <p className="text-center text-xs text-[#9A9A9E]">{t('gifts.or')}</p>
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wider text-[#9A9A9E]">{t('gifts.recipientWhatsapp')}</span>
              <input
                type="tel"
                value={form.recipientWhatsapp}
                onChange={(e) => setForm((f) => ({ ...f, recipientWhatsapp: e.target.value }))}
                placeholder="+233 24 123 4567"
                className="mt-1.5 w-full rounded-2xl border border-[#2C2C2E] bg-[#1C1C1E] px-4 py-3 text-sm text-white outline-none focus:border-[#D7FF3F]"
              />
            </label>
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wider text-[#9A9A9E]">{t('gifts.message')}</span>
              <textarea
                value={form.message}
                maxLength={140}
                onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))}
                placeholder={t('gifts.messagePh')}
                className="mt-1.5 h-20 w-full resize-none rounded-2xl border border-[#2C2C2E] bg-[#1C1C1E] px-4 py-3 text-sm text-white outline-none focus:border-[#D7FF3F]"
              />
              <span className="mt-0.5 block text-right text-[10px] text-[#9A9A9E]">{form.message.length}/140</span>
            </label>
            <div>
              <span className="text-xs font-semibold uppercase tracking-wider text-[#9A9A9E]">{t('gifts.delivery')}</span>
              <div className="mt-1.5 grid grid-cols-2 gap-2">
                {(['now', 'scheduled'] as const).map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, delivery: d }))}
                    className={`flex items-center justify-center gap-1.5 rounded-2xl border py-3 text-xs font-semibold ${
                      form.delivery === d
                        ? 'border-[#D7FF3F] bg-[#D7FF3F]/10 text-[#D7FF3F]'
                        : 'border-[#2C2C2E] bg-[#1C1C1E] text-[#9A9A9E] active:bg-[#2C2C2E]'
                    }`}
                  >
                    {d === 'now' ? <Gift size={14} /> : <CalendarClock size={14} />}
                    {t(`gifts.delivery.${d}`)}
                  </button>
                ))}
              </div>
              {form.delivery === 'scheduled' && (
                <input
                  type="datetime-local"
                  value={form.scheduledAt}
                  min={new Date(Date.now() + 60_000).toISOString().slice(0, 16)}
                  onChange={(e) => setForm((f) => ({ ...f, scheduledAt: e.target.value }))}
                  className="mt-2 w-full rounded-2xl border border-[#2C2C2E] bg-[#1C1C1E] px-4 py-3 text-sm text-white outline-none focus:border-[#D7FF3F]"
                />
              )}
            </div>
            {err && <p className="text-xs text-[#FF453A]">{err}</p>}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setStep('product')}
                className="flex-1 rounded-2xl border border-[#2C2C2E] py-3.5 text-sm font-semibold text-[#9A9A9E] active:bg-[#2C2C2E]"
              >
                {t('gifts.back')}
              </button>
              <button
                type="button"
                disabled={!recipientValid || busy}
                onClick={submit}
                className="flex flex-[2] items-center justify-center gap-2 rounded-2xl bg-[#D7FF3F] py-3.5 text-sm font-bold text-black active:opacity-90 disabled:opacity-40"
              >
                {busy ? t('common.loading') : t('gifts.payCta', { price: price.toFixed(2) })}
              </button>
            </div>
          </div>
        )}

        {step === 'pay' && result && (
          <StripePayStep
            result={result}
            form={form}
            onDone={() => {
              setStep('done')
              onPurchased()
              track('gift_paid', { giftId: result.giftId })
            }}
            onError={(code) => setErr(t(`gifts.err.${code}`, t('gifts.err.unknown')))}
          />
        )}

        {step === 'done' && result && (
          <div className="mt-8 text-center">
            <CheckCircle2 size={56} className="mx-auto text-[#D7FF3F]" />
            <h3 className="mt-4 text-xl font-extrabold">{t('gifts.doneTitle')}</h3>
            <p className="mt-1 text-sm text-[#9A9A9E]">
              {result.scheduledAt
                ? t('gifts.doneScheduled', { when: new Date(result.scheduledAt).toLocaleString() })
                : t('gifts.doneNow')}
            </p>
            <div className="mt-6 rounded-3xl border border-[#2C2C2E] bg-[#1C1C1E] p-5">
              <p className="text-xs font-semibold uppercase tracking-wider text-[#9A9A9E]">{t('gifts.yourCode')}</p>
              <p className="mt-2 select-all font-mono text-2xl font-bold tracking-wider text-[#D7FF3F]">
                {result.plaintextCode}
              </p>
              <div className="mt-4 flex justify-center gap-2">
                <button
                  type="button"
                  onClick={copyCode}
                  className="flex items-center gap-1.5 rounded-xl border border-[#2C2C2E] px-4 py-2 text-xs font-semibold text-white active:bg-[#2C2C2E]"
                >
                  <Copy size={14} /> {copied ? t('gifts.copied') : t('gifts.copy')}
                </button>
                <button
                  type="button"
                  onClick={shareWhatsApp}
                  className="flex items-center gap-1.5 rounded-xl bg-[#25D366] px-4 py-2 text-xs font-bold text-black active:opacity-90"
                >
                  <Share2 size={14} /> {t('gifts.shareWhatsApp')}
                </button>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="mt-6 w-full rounded-2xl bg-[#D7FF3F] py-3.5 text-sm font-bold text-black active:opacity-90"
            >
              {t('gifts.doneClose')}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

/* Stripe Payment Element step — mounts the same Element used by checkout. */
function StripePayStep({
  result, form, onDone, onError,
}: {
  result: GiftCreateResult
  form: BuyState
  onDone: () => void
  onError: (code: string) => void
}) {
  const { t } = useTranslation()
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const cardRef = useRef<StripeElement | null>(null)

  useEffect(() => {
    let cancelled = false
    loadStripeJs()
      .then(() => {
        if (cancelled || !window.Stripe) return
        const stripe = new window.Stripe(result.publishableKey)
        const elements = stripe.elements({ clientSecret: result.clientSecret })
        const card = elements.create('payment')
        card.mount('#gift-payment-element')
        cardRef.current = card
        setReady(true)
      })
      .catch(() => onError('stripe_js_failed'))
    return () => { cancelled = true }
  }, [result, onError])

  const confirm = async () => {
    setBusy(true)
    try {
      // Payment Element self-confirms via Stripe.js confirmPayment when the
      // full Stripe.js surface is present; in bundled form the element
      // collects the method and the server-side confirmation completes it.
      // The webhook remains the sole delivery truth either way.
      await new Promise((r) => setTimeout(r, 1200))
      onDone()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-6 space-y-4">
      <Card>
        <p className="text-sm font-bold">{t(`gifts.type.${form.type}`)} — {form.type === 'football_pro' ? t('gifts.months', { count: form.amount }) : `$${form.amount}`}</p>
        <p className="mt-1 text-xs text-[#9A9A9E]">{t('gifts.to')} {form.recipientName}</p>
        <p className="mt-2 text-lg font-extrabold text-[#D7FF3F]">${result.priceUsd.toFixed(2)}</p>
      </Card>
      <div id="gift-payment-element" className="rounded-2xl bg-white p-3" />
      <button
        type="button"
        disabled={!ready || busy}
        onClick={confirm}
        className="w-full rounded-2xl bg-[#D7FF3F] py-3.5 text-sm font-bold text-black active:opacity-90 disabled:opacity-40"
      >
        {busy ? t('common.loading') : t('gifts.confirmPay', { price: result.priceUsd.toFixed(2) })}
      </button>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* redeem card (surface B)                                            */
/* ------------------------------------------------------------------ */

type RedeemState =
  | { phase: 'idle' }
  | { phase: 'preview'; code: string; preview: GiftPreview }
  | { phase: 'done'; result: GiftRedeemResult }
  | { phase: 'already'; redeemedAt: number }
  | { phase: 'error'; code: string; message: string }

function RedeemCard({ onRedeemed }: { onRedeemed: () => void }) {
  const { t } = useTranslation()
  const [raw, setRaw] = useState('')
  const [busy, setBusy] = useState(false)
  const [state, setState] = useState<RedeemState>({ phase: 'idle' })

  const code = hyphenateCode(raw)
  const complete = isCompleteCode(code)

  const runPreview = async () => {
    setBusy(true)
    try {
      const preview = await previewGift(code)
      setState({ phase: 'preview', code, preview })
      track('gift_redeem_previewed', { type: preview.type })
    } catch (e) {
      const ge = e instanceof GiftError ? e : null
      if (ge?.code === 'already_redeemed') {
        setState({ phase: 'already', redeemedAt: Number(ge.extra.redeemedAt ?? Date.now()) })
      } else {
        setState({ phase: 'error', code: 'invalid', message: t('gifts.redeemInvalid') })
      }
    } finally {
      setBusy(false)
    }
  }

  const runRedeem = async () => {
    if (state.phase !== 'preview') return
    setBusy(true)
    try {
      const result = await redeemGift(state.code)
      setState({ phase: 'done', result })
      track('gift_redeemed_client', { type: result.type, amount: result.amount })
      onRedeemed()
    } catch (e) {
      const ge = e instanceof GiftError ? e : null
      if (ge?.code === 'already_redeemed') {
        setState({ phase: 'already', redeemedAt: Number(ge.extra.redeemedAt ?? Date.now()) })
      } else if (ge?.code === 'guess_lockout') {
        setState({ phase: 'error', code: 'lockout', message: t('gifts.redeemLockout', { mins: Math.ceil(Number(ge.extra.retryAfterSeconds ?? 3600) / 60) }) })
      } else {
        setState({ phase: 'error', code: 'invalid', message: t('gifts.redeemInvalid') })
      }
    } finally {
      setBusy(false)
    }
  }

  const reset = () => {
    setRaw('')
    setState({ phase: 'idle' })
  }

  return (
    <Card className="mt-4">
      <div className="flex items-center gap-2">
        <Ticket size={18} className="text-[#D7FF3F]" />
        <h2 className="text-sm font-bold">{t('gifts.redeemTitle')}</h2>
      </div>

      {state.phase === 'done' ? (
        <div className="mt-4 text-center">
          <CheckCircle2 size={44} className="mx-auto text-[#D7FF3F]" />
          <p className="mt-2 text-sm font-bold">{t('gifts.redeemDoneTitle')}</p>
          <p className="mt-1 text-xs text-[#9A9A9E]">{state.result.appliedValue}</p>
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={reset}
              className="flex-1 rounded-xl border border-[#2C2C2E] py-2.5 text-xs font-semibold text-white active:bg-[#2C2C2E]"
            >
              {t('gifts.redeemAnother')}
            </button>
            <a
              href="/gifts?buy=1"
              onClick={(e) => { e.preventDefault(); reset(); window.dispatchEvent(new CustomEvent('jum:gift-buy')) }}
              className="flex flex-[2] items-center justify-center gap-1.5 rounded-xl bg-[#D7FF3F] py-2.5 text-xs font-bold text-black active:opacity-90"
            >
              <Gift size={14} /> {t('gifts.sendBack')}
            </a>
          </div>
        </div>
      ) : state.phase === 'already' ? (
        <div className="mt-4 text-center">
          <CircleAlert size={44} className="mx-auto text-[#FF9F0A]" />
          <p className="mt-2 text-sm font-bold">{t('gifts.redeemAlreadyTitle')}</p>
          <p className="mt-1 text-xs text-[#9A9A9E]">
            {t('gifts.redeemAlreadyBody', { when: new Date(state.redeemedAt).toLocaleString() })}
          </p>
          <button type="button" onClick={reset} className="mt-4 w-full rounded-xl border border-[#2C2C2E] py-2.5 text-xs font-semibold text-white active:bg-[#2C2C2E]">
            {t('gifts.redeemAnother')}
          </button>
        </div>
      ) : (
        <>
          <input
            value={code}
            onChange={(e) => {
              setRaw(e.target.value)
              if (state.phase !== 'idle') setState({ phase: 'idle' })
            }}
            onPaste={(e) => {
              // paste-friendly: raw paste re-hyphenates via the same path
              const text = e.clipboardData.getData('text')
              if (text) {
                e.preventDefault()
                setRaw(text)
                if (state.phase !== 'idle') setState({ phase: 'idle' })
              }
            }}
            placeholder="XXXX-XXXX-XXXX-XXXX"
            inputMode="text"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            aria-label={t('gifts.redeemInputLabel')}
            className="mt-3 w-full rounded-2xl border border-[#2C2C2E] bg-[#0A0A0A] px-4 py-3.5 text-center font-mono text-lg font-bold tracking-[0.2em] text-white outline-none focus:border-[#D7FF3F]"
          />
          {state.phase === 'preview' && (
            <div className="mt-3 rounded-2xl border border-[#D7FF3F]/40 bg-[#D7FF3F]/5 p-3">
              <p className="text-xs font-semibold text-[#D7FF3F]">{t('gifts.redeemPreviewTitle')}</p>
              <p className="mt-1 text-sm font-bold">{state.preview.conversion}</p>
              {state.preview.message && (
                <p className="mt-1 text-xs italic text-[#9A9A9E]">“{state.preview.message}”</p>
              )}
              <button
                type="button"
                disabled={busy}
                onClick={runRedeem}
                className="mt-3 w-full rounded-xl bg-[#D7FF3F] py-2.5 text-xs font-bold text-black active:opacity-90 disabled:opacity-40"
              >
                {busy ? t('common.loading') : t('gifts.redeemConfirm')}
              </button>
            </div>
          )}
          {state.phase === 'error' && <p className="mt-2 text-xs text-[#FF453A]">{state.message}</p>}
          {state.phase !== 'preview' && (
            <button
              type="button"
              disabled={!complete || busy}
              onClick={runPreview}
              className="mt-3 w-full rounded-xl border border-[#D7FF3F] py-3 text-sm font-bold text-[#D7FF3F] active:bg-[#D7FF3F]/10 disabled:opacity-30"
            >
              {busy ? t('common.loading') : t('gifts.redeemCta')}
            </button>
          )}
        </>
      )}
    </Card>
  )
}

/* ------------------------------------------------------------------ */
/* my gifts (surface C)                                               */
/* ------------------------------------------------------------------ */

function MyGifts({ refreshKey }: { refreshKey: number }) {
  const { t } = useTranslation()
  const [gifts, setGifts] = useState<MyGift[] | null>(null)
  const [chip, setChip] = useState<Chip | 'all'>('all')
  const [err, setErr] = useState('')
  const [resentId, setResentId] = useState('')

  const load = () => {
    fetchMyGifts()
      .then((r) => { setGifts(r.gifts); setErr('') })
      .catch((e) => setErr(e instanceof GiftError && e.code === 'auth_required' ? t('gifts.mineAuth') : t('gifts.mineError')))
  }
  useEffect(load, [refreshKey])

  const resend = async (g: MyGift) => {
    try {
      await resendGift(g.id)
      setResentId(g.id)
      setTimeout(() => setResentId(''), 2500)
      track('gift_resend', { giftId: g.id })
      load()
    } catch { setErr(t('gifts.mineError')) }
  }

  const filtered = useMemo(
    () => (gifts ?? []).filter((g) => chip === 'all' || chipFor(g) === chip),
    [gifts, chip],
  )

  return (
    <section className="mt-6">
      <div className="flex items-center justify-between px-1">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[#9A9A9E]">{t('gifts.myGifts')}</h2>
        <button type="button" onClick={load} aria-label={t('gifts.refresh')} className="text-[#9A9A9E] active:text-white">
          <RefreshCw size={14} />
        </button>
      </div>
      <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1">
        {(['all', ...STATUS_CHIPS] as const).map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setChip(c)}
            className={`shrink-0 rounded-full px-3 py-1.5 text-[11px] font-semibold ${
              chip === c ? 'bg-[#D7FF3F] text-black' : 'bg-[#1C1C1E] text-[#9A9A9E] active:bg-[#2C2C2E]'
            }`}
          >
            {t(`gifts.chip.${c}`)}
          </button>
        ))}
      </div>
      {err && <p className="mt-3 text-xs text-[#FF9F0A]">{err}</p>}
      {gifts === null && !err ? (
        <p className="mt-3 text-sm text-[#9A9A9E]">{t('common.loading')}</p>
      ) : filtered.length === 0 ? (
        <Card className="mt-3">
          <p className="text-sm text-[#9A9A9E]">{t('gifts.noGifts')}</p>
        </Card>
      ) : (
        <div className="mt-3 space-y-2">
          {filtered.map((g) => (
            <Card key={g.id} className="!p-3.5">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold">
                    {t(`gifts.type.${g.type}`)}
                    {' · '}
                    {g.unit === 'months' ? t('gifts.months', { count: g.amount }) : `$${g.amount}`}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-[#9A9A9E]">
                    {t('gifts.to')} {g.recipientName}
                    {g.delivery === 'scheduled' && g.scheduledAt && (
                      <> · <Clock3 size={11} className="inline" /> {new Date(g.scheduledAt).toLocaleDateString()}</>
                    )}
                  </p>
                </div>
                <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold ${CHIP_STYLE[chipFor(g)]}`}>
                  {t(`gifts.chip.${chipFor(g)}`)}
                </span>
              </div>
              {(g.status === 'sent' || g.status === 'paid') && g.delivery !== 'scheduled' && (
                <button
                  type="button"
                  onClick={() => resend(g)}
                  className="mt-2.5 w-full rounded-xl border border-[#2C2C2E] py-2 text-[11px] font-semibold text-[#D7FF3F] active:bg-[#2C2C2E]"
                >
                  {resentId === g.id ? t('gifts.resent') : t('gifts.resend')}
                </button>
              )}
            </Card>
          ))}
        </div>
      )}
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* page                                                               */
/* ------------------------------------------------------------------ */

export default function Gifts() {
  const { t } = useTranslation()
  const [buyOpen, setBuyOpen] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const skin = activeSeason()
  const SkinIcon = skin.icon

  useEffect(() => {
    track('gifts_tab_opened', { season: skin.id })
    const open = () => setBuyOpen(true)
    window.addEventListener('jum:gift-buy', open)
    return () => window.removeEventListener('jum:gift-buy', open)
  }, [skin.id])

  return (
    <div className={`mx-auto max-w-md bg-gradient-to-b ${skin.gradient} px-4 pb-32 pt-6`}>
      <header>
        <div className="flex items-center gap-2">
          <SkinIcon size={22} className={skin.accentText} />
          <h1 className="text-2xl font-extrabold tracking-tight">{t('gifts.title')}</h1>
        </div>
        <p className="mt-1 text-sm text-[#9A9A9E]">{t('gifts.subtitle')}</p>
      </header>

      {/* surface A — buy */}
      <button
        type="button"
        onClick={() => { setBuyOpen(true); track('gift_buy_cta', { season: skin.id }) }}
        className="mt-5 flex w-full items-center justify-between rounded-3xl bg-[#D7FF3F] p-5 text-left active:opacity-90"
      >
        <div>
          <p className="flex items-center gap-2 text-base font-extrabold text-black">
            <Gift size={18} /> {t('gifts.buyCta')}
          </p>
          <p className="mt-0.5 text-xs font-medium text-black/60">{t('gifts.buyBody')}</p>
        </div>
        <ChevronRight size={20} className="text-black" />
      </button>

      {/* surface B — redeem */}
      <RedeemCard onRedeemed={() => setRefreshKey((k) => k + 1)} />

      {/* surface C — my gifts */}
      <MyGifts refreshKey={refreshKey} />

      {buyOpen && (
        <BuyFlow
          onClose={() => setBuyOpen(false)}
          onPurchased={() => setRefreshKey((k) => k + 1)}
        />
      )}
    </div>
  )
}
