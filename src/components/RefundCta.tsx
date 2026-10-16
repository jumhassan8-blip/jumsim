import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RotateCcw, ShieldOff, TimerOff } from 'lucide-react'
import { executeRefund, formatWindowCountdown } from '../lib/guarantee'
import { track } from '../lib/analytics'
import { useStore } from '../state/StoreContext'
import type { Purchase } from '../types'

interface Props {
  purchase: Purchase
  guarantee:
    | {
        windowOpen: boolean
        guaranteeEndsAt: number
        refundInProgress: boolean
        refundedAt: number | null
        status: string
      }
    | undefined
  /** compact variant for the My eSIMs card footer */
  compact?: boolean
  onRefunded?: () => void
}

/**
 * "No signal? Request refund" — the anti-cheat refund entry point. Shows the
 * 10-minute countdown (display only — the server re-checks everything at
 * execute time). Tapping opens the confirm sheet; confirming runs
 * POST /api/refund/execute: verify unused → TERMINATE AT SUPPLIER → only
 * then Stripe refunds. Abort on any failure, zero silent money moves.
 */
export default function RefundCta({ purchase, guarantee, compact = false, onRefunded }: Props) {
  const { t } = useTranslation()
  const { markServerRefunded, toast } = useStore()
  const [confirming, setConfirming] = useState(false)
  const [executing, setExecuting] = useState(false)
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [])

  const g = guarantee
  const alreadyRefunded = purchase.status === 'refunded' || g?.status === 'refunded_terminated'
  const visible = g?.windowOpen && !alreadyRefunded
  const locked = g?.refundInProgress

  useEffect(() => {
    if (visible) track('refund_button_viewed', { orderId: purchase.order.id, surface: compact ? 'my_esims' : 'detail' })
  }, [visible, purchase.order.id, compact])

  const run = async () => {
    if (executing) return
    setExecuting(true)
    track('refund_requested', { orderId: purchase.order.id })
    try {
      const r = await executeRefund(purchase.order.id)
      if (r.ok) {
        track('refund_executed', { orderId: purchase.order.id, amountUSD: r.amountUSD ?? purchase.plan.priceUSD })
        markServerRefunded(purchase.order.id)
        onRefunded?.()
        setConfirming(false)
        toast(
          t('refund.done', { amount: (r.amountUSD ?? purchase.plan.priceUSD).toFixed(2) }),
          'success',
        )
      } else if (r.reason === 'in_use') {
        track('refund_denied_in_use', { orderId: purchase.order.id })
        setConfirming(false)
        toast(t('refund.deniedInUse'), 'error')
      } else if (r.reason === 'cant_terminate' || r.reason === 'stripe_failed' || r.reason === 'stripe_unavailable') {
        track('refund_denied_cant_terminate', { orderId: purchase.order.id, reason: r.reason })
        setConfirming(false)
        toast(r.message ?? t('refund.cantTerminate'), 'info')
      } else if (r.reason === 'window_expired') {
        setConfirming(false)
        toast(t('refund.deniedExpired'), 'error')
      } else if (r.reason === 'refund_in_progress') {
        toast(t('refund.inProgress'), 'info')
      } else {
        setConfirming(false)
        toast(r.message ?? t('refund.tryAgain'), 'info')
      }
    } finally {
      setExecuting(false)
    }
  }

  if (alreadyRefunded) {
    return (
      <p className="flex items-center gap-2 text-xs font-semibold text-[#6E6E73]">
        <ShieldOff size={14} className="shrink-0" />
        {t('refund.refundedTerminated')}
      </p>
    )
  }
  if (!visible) return null

  return (
    <>
      <button
        onClick={() => {
          track('refund_requested', { orderId: purchase.order.id, stage: 'confirm_sheet_opened' })
          setConfirming(true)
        }}
        disabled={locked}
        className={`flex items-center justify-center gap-2 font-semibold text-[#FF6961] active:opacity-80 disabled:opacity-40 ${
          compact ? 'min-h-[36px] text-xs' : 'min-h-[48px] w-full rounded-xl border border-[#FF453A]/40 text-sm'
        }`}
      >
        <RotateCcw size={compact ? 12 : 14} />
        {locked ? t('refund.inProgress') : t('refund.cta', { time: formatWindowCountdown(g!.guaranteeEndsAt, now) })}
      </button>

      {confirming && (
        <div
          className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60"
          role="dialog"
          aria-modal="true"
          aria-label={t('refund.confirmTitle')}
        >
          <div className="w-full max-w-md rounded-t-[24px] border-t border-[#2C2C2E] bg-[#161618] px-6 pb-8 pt-6">
            <h2 className="text-center text-xl font-semibold text-white">
              {t('refund.confirmTitle', { amount: purchase.plan.priceUSD.toFixed(2) })}
            </h2>
            <p className="mt-3 text-center text-sm leading-relaxed text-[#9A9A9E]">
              {t('refund.confirmBody')}
            </p>
            <div className="mt-3 flex items-center justify-center gap-1.5 text-xs text-[#FF9F0A]">
              <TimerOff size={12} />
              {t('refund.windowChip', { time: formatWindowCountdown(g!.guaranteeEndsAt, now) })}
            </div>
            <button
              onClick={() => void run()}
              disabled={executing}
              className="mt-5 flex min-h-[52px] w-full items-center justify-center rounded-2xl bg-[#FF453A] text-base font-semibold text-white transition-opacity active:opacity-80 disabled:opacity-50"
            >
              {executing ? t('refund.processing') : t('refund.confirmCta')}
            </button>
            <button
              onClick={() => setConfirming(false)}
              disabled={executing}
              className="mt-2 flex min-h-[48px] w-full items-center justify-center rounded-2xl bg-[#2C2C2E] text-sm font-semibold text-white active:bg-[#3A3A3C]"
            >
              {t('refund.keepEsim')}
            </button>
          </div>
        </div>
      )}
    </>
  )
}
