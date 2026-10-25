import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import {
  CheckCircle2,
  Download,
  LifeBuoy,
  Loader2,
  RotateCcw,
  ShieldOff,
  Zap,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { CONFIG } from '../config'
import { useStore } from '../state/StoreContext'
import { track } from '../lib/analytics'
import { formatPlanSize } from '../lib/money'
import { isRatingPromptEligible } from '../lib/rating'
import { useGuarantee } from '../lib/guarantee'
import { FlowHeader, ErrorState, Badge } from '../components/ui-bits'
import WhatsAppRow from '../components/WhatsAppRow'
import InstallPanel from '../components/InstallPanel'
import RatingSheet, { ratingChip } from '../components/RatingSheet'
import RefundCta from '../components/RefundCta'

type Phase = 'ready' | 'installing' | 'manual' | 'success'

export default function Installation() {
  const { t } = useTranslation()
  const { orderId = '' } = useParams()
  const navigate = useNavigate()
  const { purchases, markInstalled, markServerRefunded } = useStore()
  const purchase = purchases.find((p) => p.order.id === orderId)
  // server-authoritative refund state: window countdown + terminal state
  const guarantee = useGuarantee(
    purchase ? [purchase.order.id] : [],
    (id) => markServerRefunded(id),
  )[purchase?.order.id ?? '']

  const [phase, setPhase] = useState<Phase>('ready')
  const [showHelp, setShowHelp] = useState(false)
  const [showRating, setShowRating] = useState(false)
  const [now, setNow] = useState(Date.now())
  const timerRef = useRef<number | null>(null)

  // server-anchored 10-minute window (display only — the server re-checks
  // everything at execute time); falls back to the purchase clock offline
  const windowEndsAt = guarantee?.guaranteeEndsAt ?? (purchase ? purchase.order.createdAt + CONFIG.activationWindowMinutes * 60_000 : 0)
  const remainingMs = Math.max(0, windowEndsAt - now)
  const inWindow = remainingMs > 0

  // countdown ticker
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [])

  // activation window expired with no install → surface help + refund
  useEffect(() => {
    if (purchase && purchase.status === 'not_installed' && !inWindow) setShowHelp(true)
  }, [purchase, inWindow])

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current)
    }
  }, [])

  const remainingLabel = useMemo(() => {
    const s = Math.ceil(remainingMs / 1000)
    const mm = String(Math.floor(s / 60)).padStart(2, '0')
    const ss = String(s % 60).padStart(2, '0')
    return `${mm}:${ss}`
  }, [remainingMs])

  if (!purchase) {
    return (
      <div className="min-h-dvh bg-[#0A0A0A]">
        <FlowHeader title="Installation" onBack={() => navigate('/profile')} />
        <main className="mx-auto max-w-3xl px-4 pt-4">
          <ErrorState
            message="We couldn't find this order on this device."
            onRetry={() => navigate('/')}
          />
        </main>
      </div>
    )
  }

  const { order, plan, country } = purchase

  const startInstall = () => {
    track('install_started', { orderId: order.id })
    setPhase('installing')
    // attempt OS-level direct install where the platform exposes LPA handling;
    // on desktop web this is a no-op and we fall through to QR + manual steps
    try {
      if (/android/i.test(navigator.userAgent)) {
        window.location.href = order.lpaString
      }
    } catch {
      /* fall through to manual path */
    }
    window.setTimeout(() => setPhase('manual'), 1800)
  }

  const confirmInstalled = () => {
    markInstalled(order.id)
    setPhase('success')
    // the "Installation successful!" moment — offer the rating prompt BEFORE
    // auto-advancing. Eligibility (1/order, 90-day cap, rated flag, active
    // support/refund conversation) is checked here; the sheet itself is
    // mounted below while it is open.
    if (isRatingPromptEligible(order.id)) {
      setShowRating(true)
      return
    }
    timerRef.current = window.setTimeout(
      () => navigate(`/setup/${order.id}`, { replace: true }),
      1800,
    )
  }

  const closeRating = () => {
    setShowRating(false)
    timerRef.current = window.setTimeout(
      () => navigate(`/setup/${order.id}`, { replace: true }),
      400,
    )
  }

  return (
    <div className="flex min-h-dvh flex-col bg-[#0A0A0A]">
      <FlowHeader
        title="Installation"
        onBack={() => navigate(purchase.status === 'not_installed' ? '/' : '/profile')}
      />

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pt-6">
        {phase === 'success' ? (
          <div className="flex flex-col items-center gap-4 py-16 text-center">
            <CheckCircle2 size={72} className="text-[#D7FF3F]" />
            <h1 className="text-2xl font-semibold text-white">Installation successful!</h1>
            <p className="max-w-xs text-sm text-[#9A9A9E]">
              Your {country.name} eSIM is installed. Next: turn it on and connect — takes
              about a minute.
            </p>
            <button
              onClick={() => navigate(`/setup/${order.id}`, { replace: true })}
              className="flex min-h-[48px] items-center gap-2 rounded-full bg-[#D7FF3F] px-6 text-sm font-semibold text-black"
            >
              Get connected
            </button>
          </div>
        ) : purchase.status === 'refunded' ? (
          <div className="flex flex-col items-center gap-4 py-16 text-center">
            <ShieldOff size={72} className="text-[#6E6E73]" />
            <h1 className="text-2xl font-semibold text-white">{t('refund.refundedTitle')}</h1>
            <p className="max-w-xs text-sm text-[#9A9A9E]">{t('refund.refundedBody')}</p>
            <button
              onClick={() => navigate('/')}
              className="mt-2 flex min-h-[44px] items-center gap-2 rounded-full bg-[#D7FF3F] px-6 text-sm font-semibold text-black"
            >
              <RotateCcw size={16} /> Back to store
            </button>
          </div>
        ) : purchase.status !== 'not_installed' ? (
          <div className="flex flex-col items-center gap-4 py-16 text-center">
            <CheckCircle2 size={72} className="text-[#D7FF3F]" />
            <h1 className="text-2xl font-semibold text-white">Already installed</h1>
            <p className="max-w-xs text-sm text-[#9A9A9E]">
              This eSIM is already on your device.
            </p>
            <button
              onClick={() => navigate('/profile')}
              className="mt-2 min-h-[44px] rounded-full bg-[#D7FF3F] px-6 text-sm font-semibold text-black"
            >
              View in My eSIMs
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-4 pb-10">
            <div className="text-center">
              <span className="text-4xl">{country.flag}</span>
              <h1 className="mt-2 text-2xl font-semibold text-white">Your eSIM is ready</h1>
              <p className="mt-1 text-sm text-[#9A9A9E]">
                {formatPlanSize(plan.dataGB)} · {plan.days} days · not installed yet
              </p>
              <div className="mt-3 flex justify-center">
                <Badge tone={inWindow ? 'lime' : 'red'}>
                  {inWindow ? t('refund.windowOpen', { time: remainingLabel }) : t('refund.windowClosed')}
                </Badge>
              </div>
            </div>

            {phase === 'installing' ? (
              <div className="flex flex-col items-center gap-3 rounded-[14px] bg-[#1C1C1E] p-10">
                <Loader2 size={40} className="animate-spin text-[#D7FF3F]" />
                <p className="text-sm text-[#9A9A9E]">Contacting your device…</p>
              </div>
            ) : (
              <>
                {/* user-requested refund — the server terminates the eSIM at
                    the supplier BEFORE any money moves (anti-cheat) */}
                {purchase.status === 'not_installed' && inWindow && (
                  <div className="flex items-start gap-2.5 rounded-[14px] border border-[#D7FF3F]/30 bg-[#D7FF3F]/5 p-3.5">
                    <Zap size={16} className="mt-0.5 shrink-0 text-[#D7FF3F]" />
                    <p className="text-xs leading-relaxed text-[#EBEBF0]">
                      No signal? Request a refund — we cancel the eSIM at the supplier first, so
                      even a screenshot of this code stops working.
                    </p>
                  </div>
                )}
                <RefundCta purchase={purchase} guarantee={guarantee} />
                <button
                  onClick={startInstall}
                  className="flex min-h-[56px] w-full items-center justify-center gap-2 rounded-2xl bg-[#D7FF3F] text-base font-semibold text-black transition-opacity active:opacity-80"
                >
                  <Download size={20} />
                  {phase === 'manual' ? 'Retry direct install' : 'Install eSIM'}
                </button>

                {(phase === 'manual' || showHelp) && (
                  <InstallPanel order={order} email={order.email} />
                )}

                {(phase === 'manual' || showHelp) && (
                  <button
                    onClick={confirmInstalled}
                    className="min-h-[52px] w-full rounded-2xl bg-[#2C2C2E] text-base font-semibold text-white active:bg-[#3A3A3C]"
                  >
                    I installed it — continue
                  </button>
                )}
              </>
            )}

            <button
              onClick={() => setShowHelp((v) => !v)}
              className="mx-auto flex min-h-[44px] items-center gap-2 px-4 text-sm font-semibold text-[#9A9A9E] active:text-white"
            >
              <LifeBuoy size={16} />
              {showHelp ? 'Hide help' : 'Installation didn’t work?'}
            </button>

            {showHelp && (
              <div className="flex flex-col gap-3 rounded-[14px] bg-[#1C1C1E] p-4">
                <p className="text-sm text-[#9A9A9E]">
                  Get help from a human — average reply time under 5 minutes.
                </p>
                <a
                  href={`mailto:${CONFIG.supportEmail}?subject=Install%20help%20${order.iccid}`}
                  className="flex min-h-[48px] items-center justify-center rounded-xl bg-[#2C2C2E] text-sm font-semibold text-white"
                >
                  Contact support
                </a>
                <RefundCta purchase={purchase} guarantee={guarantee} />
              </div>
            )}
            <WhatsAppRow
              label="Chat with us on WhatsApp"
              hint="We can walk you through the install step by step"
              surface="install_fail"
              ctx={{ orderId: order.id, plan: plan?.name, country: country?.name }}
            />
          </div>
        )}
      </main>

      {showRating && (
        <RatingSheet
          orderId={order.id}
          chip={ratingChip(country.name, country.iso2, plan.dataGB, plan.days)}
          onClose={closeRating}
        />
      )}
    </div>
  )
}
