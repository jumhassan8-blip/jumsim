import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { Bell, ChevronRight, CircleHelp, Globe, Info, Phone, Smartphone, Wallet as WalletIcon, Languages, Coins } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useStore } from '../state/StoreContext'
import { groupByIccid, mergeUsage, displayStatus, DAY_MS } from '../lib/usage'
import { formatPlanSize } from '../lib/money'
import { usePrice } from '../lib/use-price'
import { useFx } from '../lib/fx'
import { getAnalyticsLog } from '../lib/analytics'
import { EmptyState } from '../components/ui-bits'
import { graceDaysLeft, graceDeadline } from '../lib/number'
import { loadPricing } from '../data/pricing'
import { CONFIG } from '../config'
import { detectSettingsEnv } from '../lib/settings-links'
import WhatsAppRow from '../components/WhatsAppRow'
import StatusChip from '../components/StatusChip'
import RefundCta from '../components/RefundCta'
import LanguageSheet from '../components/LanguageSheet'
import CurrencySheet from '../components/CurrencySheet'
import { useGuarantee, formatWindowCountdown } from '../lib/guarantee'
import { track } from '../lib/analytics'
import { LANGUAGE_NAMES, type Language } from '../i18n'
import { RotateCcw, User, Check } from 'lucide-react'
import { useAuth } from '../state/AuthContext'
import AccountSheet from '../components/AccountSheet'
import VerifyBanner from '../components/VerifyBanner'

/** "Guarantee valid for 06:12" — ticks every second while the window is open */
function GuaranteeChip({ endsAt }: { endsAt: number }) {
  const { t } = useTranslation()
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [])
  const left = endsAt - now
  if (left <= 0) return null
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-[#FF9F0A]/15 px-2.5 py-1 text-[10px] font-bold text-[#FF9F0A]">
      {t('refund.windowChip', { time: formatWindowCountdown(endsAt, now) })}
    </span>
  )
}

function UsageBar({ used, total }: { used: number; total: number }) {
  const pct = Math.min(100, Math.round((used / total) * 100))
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#2C2C2E]">
      <div
        className={`h-full rounded-full ${pct > 90 ? 'bg-[#FF453A]' : 'bg-[#D7FF3F]'}`}
        style={{ width: `${Math.max(2, pct)}%` }}
      />
    </div>
  )
}

function fmtMB(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)}GB`
  return `${Math.round(mb)}MB`
}

export default function Profile() {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const { i18n } = useTranslation()
  const price = usePrice()
  const fx = useFx()
  const { purchases, reloadCatalog, wallet, rentedNumber, renewNumber, releaseNumber, markServerRefunded } =
    useStore()
  const [now, setNow] = useState(Date.now())
  const [langOpen, setLangOpen] = useState(false)
  const [curOpen, setCurOpen] = useState(false)
  // Module 16 — account sheet (signed-in card tap)
  const [accountOpen, setAccountOpen] = useState(false)
  const { session: authSession, refreshVerification } = useAuth()
  const authAccount = authSession.account

  // Re-check verification every time Profile mounts — the user often verifies
  // from a mail-app link then returns here, and the cached flag may be stale.
  useEffect(() => {
    if (authAccount && !authAccount.isAnonymous) void refreshVerification()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // ANTI-CHEAT REFUND (user-requested only): the per-order CTA + confirm
  // sheet live in <RefundCta>; this key bumps the guarantee poll right after
  // a refund attempt so cards flip without waiting for the 30s tick.
  const [refundRefresh, setRefundRefresh] = useState(0)
  // server-authoritative guarantee state for every order on this device
  const guarantee = useGuarantee(
    purchases.map((p) => p.order.id),
    (orderId) => markServerRefunded(orderId),
    refundRefresh,
  )
  const [graceDays, setGraceDays] = useState(3)

  useEffect(() => {
    let alive = true
    loadPricing()
      .then((p) => alive && setGraceDays(p.numberRental.gracePeriodDays))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  // re-render countdowns / usage burn every minute
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(t)
  }, [])

  const groups = useMemo(() => groupByIccid(purchases), [purchases])

  const enriched = useMemo(
    () =>
      groups.map(({ base, topUps }) => ({
        base,
        topUps,
        status: displayStatus(base, topUps, now),
        usage: mergeUsage(base, topUps, now),
      })),
    [groups, now],
  )

  // web has no push without a backend — surface the same triggers in-app
  const alerts = enriched
    .filter((e) => e.status === 'active')
    .map((e) => {
      const remaining = 1 - e.usage.usedMB / e.usage.totalMB
      const hoursLeft = (e.usage.expiresAt - now) / 3_600_000
      if (remaining < 0.1)
        return {
          key: `data-${e.base.order.iccid}`,
          text: t('profile.alertLowData', { country: e.base.country.name }),
          cta: t('profile.alertTopUp'),
          to: `/esims/${e.base.order.iccid}`,
        }
      if (hoursLeft < 48)
        return {
          key: `exp-${e.base.order.iccid}`,
          text: t('profile.alertExpiring', {
            country: e.base.country.name,
            hours: Math.max(1, Math.round(hoursLeft)),
          }),
          cta: t('profile.alertExtend'),
          to: `/esims/${e.base.order.iccid}`,
        }
      return null
    })
    .filter((a): a is NonNullable<typeof a> => a !== null)

  const analytics = getAnalyticsLog().slice(-8).reverse()
  // 'preview' = running in a browser; ios-/android-device = native phone build
  const settingsEnv = detectSettingsEnv()
  // newest order → prefilled into the WhatsApp opener ("help with my order …")
  const latestOrder = purchases
    .map((p) => p.order)
    .sort((a, b) => b.createdAt - a.createdAt)[0]

  return (
    <div className="mx-auto max-w-5xl px-4 pb-32 pt-6">
      <h1 className="mb-1 text-2xl font-semibold tracking-tight text-white">{t('profile.title')}</h1>
      <p className="mb-5 text-sm text-[#9A9A9E]">
        {enriched.length === 0
          ? t('profile.subtitleZero')
          : t('profile.subtitleCount', { count: enriched.length })}
      </p>

      {/* Module 17 — verify-your-email banner after sign-up */}
      <VerifyBanner />

      {/* Module 16 — account card: signed out → lime CTA; signed in → identity + sync */}
      {!authAccount || authAccount.isAnonymous ? (
        <button
          onClick={() => navigate('/auth')}
          className="mb-4 flex w-full items-center gap-3 rounded-[14px] bg-[#D7FF3F] p-4 text-left transition-opacity active:opacity-90"
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-black/15">
            <User size={18} className="text-black" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-bold text-black">{t('profile.signInCardTitle')}</span>
            <span className="block text-xs font-medium text-black/70">{t('profile.signInCardHint')}</span>
          </span>
          <ChevronRight size={18} className="text-black flip-rtl" />
        </button>
      ) : (
        <button
          onClick={() => setAccountOpen(true)}
          className="mb-4 flex w-full items-center gap-3 rounded-[14px] bg-[#1C1C1E] p-4 text-left transition-colors active:bg-[#2C2C2E]"
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#D7FF3F] text-sm font-bold text-black">
            {authAccount.email?.charAt(0).toUpperCase() ?? '?'}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-white">{authAccount.email}</span>
            <span className="block text-xs text-[#9A9A9E]">
              {authSession.syncedAt
                ? t('profile.lastSynced', {
                    time: new Intl.RelativeTimeFormat(i18n.language, { numeric: 'auto' }).format(
                      -Math.max(1, Math.round((Date.now() - authSession.syncedAt) / 60000)),
                      'minute',
                    ),
                  })
                : t('profile.syncPendingBody')}
            </span>
          </span>
          {authSession.syncedAt && Date.now() - authSession.syncedAt < 5 * 60_000 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-[#32D74B]/15 px-2.5 py-1 text-[10px] font-bold text-[#32D74B]">
              <Check size={10} /> {t('profile.synced')}
            </span>
          )}
          <ChevronRight size={18} className="text-[#9A9A9E] flip-rtl" />
        </button>
      )}

      {/* Module 3 — call credit wallet */}
      <button
        onClick={() => navigate('/wallet')}
        className="mb-4 flex w-full items-center gap-3 rounded-[14px] bg-[#1C1C1E] p-4 text-left transition-colors active:bg-[#2C2C2E]"
      >
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#D7FF3F]/10">
          <WalletIcon size={18} className="text-[#D7FF3F]" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-white">{t('profile.callCredit')}</span>
          <span className="block text-xs text-[#9A9A9E]">
            {wallet.balance > 0
              ? t('profile.callCreditHas', { balance: price(wallet.balance), range: `${price(3)}–${price(20)}` })
              : t('profile.callCreditNone', { range: `${price(3)}–${price(20)}` })}
          </span>
        </span>
        <ChevronRight size={18} className="text-[#9A9A9E] flip-rtl" />
      </button>

      {/* Module 5 — rented number (caller ID) */}
      {rentedNumber ? (
        <div className="mb-4 rounded-[14px] bg-[#1C1C1E] p-4">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#D7FF3F]/10">
              <Phone size={18} className="text-[#D7FF3F]" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-white">{t('profile.myNumber')}</span>
              <span className="block font-mono text-xs text-[#9A9A9E]">
                {rentedNumber.number}
              </span>
            </span>
            {rentedNumber.status === 'active' && (
              <span className="rounded-full bg-[#D7FF3F]/15 px-2.5 py-1 text-[10px] font-bold text-[#D7FF3F]">
                {t('profile.numberActive')}
              </span>
            )}
            {rentedNumber.status === 'pending_verification' && (
              <span className="rounded-full bg-[#FF9F0A]/15 px-2.5 py-1 text-[10px] font-bold text-[#FF9F0A]">
                {t('profile.numberVerify')}
              </span>
            )}
            {rentedNumber.status === 'grace' && (
              <span className="rounded-full bg-[#FF453A]/15 px-2.5 py-1 text-[10px] font-bold text-[#FF6961]">
                {t('profile.numberExpiring')}
              </span>
            )}
          </div>

          {rentedNumber.status === 'grace' && (
            <div className="mt-3 rounded-xl border border-[#FF453A]/40 bg-[#FF453A]/10 p-3">
              <p className="text-xs font-semibold text-[#FF6961]">
                {t('profile.graceLeft', { count: graceDaysLeft(rentedNumber, graceDays) ?? 0 })}
              </p>
              <p className="mt-0.5 text-[11px] text-[#9A9A9E]">
                {t('profile.renewBy', {
                  date: new Date(graceDeadline(rentedNumber, graceDays)).toLocaleDateString(),
                  number: rentedNumber.number,
                })}
              </p>
            </div>
          )}

          <div className="mt-3 flex gap-2">
            {rentedNumber.status !== 'pending_verification' && (
              <button
                onClick={() => void renewNumber(rentedNumber.sid)}
                className="min-h-[44px] flex-1 rounded-xl bg-[#D7FF3F] text-xs font-bold text-black"
              >
                {t('profile.renewPerMonth', { price: price(rentedNumber.monthlyUSD) })}
              </button>
            )}
            {rentedNumber.status === 'pending_verification' && (
              <button
                onClick={() => navigate('/number/verify?sid=' + encodeURIComponent(rentedNumber.sid))}
                className="min-h-[44px] flex-1 rounded-xl bg-[#D7FF3F] text-xs font-bold text-black"
              >
                {t('profile.finishVerification')}
              </button>
            )}
            <button
              onClick={() => {
                if (window.confirm(t('profile.releaseConfirm'))) {
                  void releaseNumber(rentedNumber.sid)
                }
              }}
              className="min-h-[44px] rounded-xl bg-[#2C2C2E] px-4 text-xs font-semibold text-[#FF6961]"
            >
              {t('profile.release')}
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => navigate('/number/country')}
          className="mb-4 flex w-full items-center gap-3 rounded-[14px] bg-[#1C1C1E] p-4 text-left transition-colors active:bg-[#2C2C2E]"
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#D7FF3F]/10">
            <Phone size={18} className="text-[#D7FF3F]" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-white">{t('profile.chooseNumber')}</span>
            <span className="block text-xs text-[#9A9A9E]">
              {t('profile.rentNumberHint', { price: price(1.99) })}
            </span>
          </span>
          <ChevronRight size={18} className="text-[#9A9A9E] flip-rtl" />
        </button>
      )}

      {/* Module 6 — support surfaces: WhatsApp card + Help row sit together */}
      <WhatsAppRow
        label={t('support.chatOnWhatsApp')}
        hint={t('profile.whatsappHint')}
        surface="profile"
        ctx={latestOrder ? { orderId: latestOrder.id } : undefined}
      />
      {/* preview/web only: on a real phone the same tap opens WhatsApp directly */}
      {settingsEnv === 'preview' && (
        <p className="mb-4 -mt-3 text-center text-[11px] text-[#6E6E73]">
          {t('profile.previewNote')}
        </p>
      )}

      {/* Module 15 — localization: language + currency, always visible */}
      <button
        onClick={() => setLangOpen(true)}
        className="mb-4 flex w-full items-center gap-3 rounded-[14px] bg-[#1C1C1E] p-4 text-left transition-colors active:bg-[#2C2C2E]"
      >
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#D7FF3F]/10">
          <Languages size={18} className="text-[#D7FF3F]" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-white">{t('profile.language')}</span>
          <span className="block text-xs text-[#9A9A9E]">
            {LANGUAGE_NAMES[i18n.language as Language] ?? i18n.language}
          </span>
        </span>
        <ChevronRight size={18} className="text-[#9A9A9E] flip-rtl" />
      </button>
      <button
        onClick={() => setCurOpen(true)}
        className="mb-4 flex w-full items-center gap-3 rounded-[14px] bg-[#1C1C1E] p-4 text-left transition-colors active:bg-[#2C2C2E]"
      >
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#D7FF3F]/10">
          <Coins size={18} className="text-[#D7FF3F]" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-white">{t('profile.currency')}</span>
          <span className="block text-xs text-[#9A9A9E]">
            {fx.override === 'auto' ? t('profile.currencyAuto') : fx.currency}
          </span>
        </span>
        <ChevronRight size={18} className="text-[#9A9A9E] flip-rtl" />
      </button>

      {/* Module 14 — Refund card: ALWAYS visible (the guarantee is marketing,
          not just a function). Sits between the WhatsApp card and Help row. */}
      {(() => {
        const refundableCount = purchases.filter((p) => {
          const g = guarantee[p.order.id]
          return g?.windowOpen && p.status === 'not_installed'
        }).length
        return (
          <button
            onClick={() => {
              track('refund_card_tapped', {
                hasPurchases: purchases.length > 0,
                refundableCount,
              })
              if (purchases.length === 0) {
                // never a dead tap — take them shopping
                navigate('/explore')
              } else {
                track('refund_card_orders', { orders: purchases.length })
                navigate('/help')
              }
            }}
            className="mb-4 flex w-full items-center gap-3 rounded-[14px] bg-[#1C1C1E] p-4 text-left transition-colors active:bg-[#2C2C2E]"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#D7FF3F]">
              <RotateCcw size={18} className="text-black" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-white">
                {t('profile.refundCardTitle')}
              </span>
              <span className="block text-xs text-[#9A9A9E]">
                {purchases.length > 0
                  ? t('profile.refundCardHas')
                  : t('profile.refundCardNone')}
              </span>
            </span>
            {/* eye-drawing badge: only at the exact moment it matters */}
            {refundableCount > 0 && (
              <span
                aria-label={t('profile.refundableBadge', { count: refundableCount })}
                className="h-2.5 w-2.5 shrink-0 rounded-full bg-[#D7FF3F]"
              />
            )}
            <ChevronRight size={18} className="text-[#D7FF3F] flip-rtl" />
          </button>
        )
      })()}
      <button
        onClick={() => navigate('/help')}
        className="mb-4 flex w-full items-center gap-3 rounded-[14px] bg-[#1C1C1E] p-4 text-left transition-colors active:bg-[#2C2C2E]"
      >
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#D7FF3F]/10">
          <CircleHelp size={18} className="text-[#D7FF3F]" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-white">{t('profile.help')}</span>
          <span className="block text-xs text-[#9A9A9E]">
            {t('profile.helpHint', { email: CONFIG.supportEmail })}
          </span>
        </span>
        <ChevronRight size={18} className="text-[#9A9A9E] flip-rtl" />
      </button>

      {/* in-app stand-in for push notifications */}
      {alerts.length > 0 && (
        <div className="mb-4 flex flex-col gap-2">
          {alerts.map((a) => (
            <div
              key={a.key}
              className="flex items-center gap-3 rounded-[14px] border border-[#D7FF3F]/30 bg-[#D7FF3F]/5 p-3"
            >
              <Bell size={18} className="shrink-0 text-[#D7FF3F]" />
              <p className="min-w-0 flex-1 text-xs text-[#EBEBF0]">{a.text}</p>
              <button
                onClick={() => navigate(a.to)}
                className="min-h-[44px] shrink-0 rounded-full bg-[#D7FF3F] px-4 text-xs font-bold text-black"
              >
                {a.cta}
              </button>
            </div>
          ))}
        </div>
      )}

      {enriched.length === 0 ? (
        <EmptyState
          icon={<Smartphone size={26} />}
          title={t('profile.emptyTitle')}
          body={t('profile.emptyBody')}
          action={
            <button
              onClick={() => {
                reloadCatalog()
                navigate('/explore')
              }}
              className="mt-1 flex min-h-[44px] items-center gap-2 rounded-full bg-[#D7FF3F] px-5 text-sm font-semibold text-black"
            >
              <Globe size={16} /> {t('profile.browse')}
            </button>
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {enriched.map(({ base, status, usage }) => {
            const daysLeft = Math.ceil((usage.expiresAt - now) / DAY_MS)
            const g = guarantee[base.order.id]
            return (
              <div
                key={base.order.iccid}
                role="button"
                tabIndex={0}
                onClick={() => {
                  // refunded cards stay visible for transparency, no longer tappable
                  if (!(g?.status === 'refunded_terminated' || base.status === 'refunded')) {
                    navigate(`/esims/${base.order.iccid}`)
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    if (!(g?.status === 'refunded_terminated' || base.status === 'refunded')) {
                      navigate(`/esims/${base.order.iccid}`)
                    }
                  }
                }}
                className={`flex flex-col gap-3 rounded-[14px] bg-[#1C1C1E] p-4 text-left transition-colors active:bg-[#2C2C2E] ${
                  g?.status === 'refunded_terminated' || base.status === 'refunded'
                    ? 'cursor-default'
                    : 'cursor-pointer'
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className="text-3xl">{base.country.flag}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-white">
                      {base.country.name}
                    </p>
                    <p className="text-xs text-[#9A9A9E]">
                      {t('home.planMeta', { size: formatPlanSize(base.plan.dataGB), days: base.plan.days })}
                    </p>
                  </div>
                  {/* guarantee chips — server-authoritative */}
                  {g?.status === 'refunded_terminated' || base.status === 'refunded' ? (
                    <span className="rounded-full bg-[#3A3A3C] px-2.5 py-1 text-[10px] font-bold text-[#9A9A9E]">
                      {t('refund.refundedTerminated')}
                    </span>
                  ) : g?.windowOpen && status === 'not_installed' ? (
                    <GuaranteeChip endsAt={g.guaranteeEndsAt} />
                  ) : null}
                  <StatusChip status={status} />
                </div>
                <UsageBar used={usage.usedMB} total={usage.totalMB} />
                <div className="flex items-center justify-between text-xs text-[#9A9A9E]">
                  <span>
                    {t('profile.usedOf', {
                      used: fmtMB(usage.usedMB),
                      total: usage.fairUseCapMB
                        ? t('profile.highSpeedOf', { cap: fmtMB(usage.fairUseCapMB) })
                        : fmtMB(usage.totalMB),
                    })}
                  </span>
                  <span className="inline-flex items-center gap-0.5">
                    {status === 'expired'
                      ? t('profile.statusExpired')
                      : daysLeft > 0
                        ? t('profile.daysLeft', { count: daysLeft })
                        : t('profile.expiresToday')}
                    <ChevronRight size={14} className="flip-rtl" />
                  </span>
                </div>
                {/* Anti-cheat refund CTA — user-triggered only. The server
                    re-verifies unused → terminates at the supplier → only
                    then refunds. Refunded cards show a final-state row. */}
                {g?.status === 'refunded_terminated' || base.status === 'refunded' ? (
                  <div className="mt-1 flex flex-col gap-1 border-t border-[#2C2C2E] pt-3">
                    <span className="inline-flex w-fit items-center gap-1 rounded-full bg-[#3A3A3C] px-2.5 py-1 text-[10px] font-bold text-[#9A9A9E]">
                      {t('refund.refundedTerminated')}
                    </span>
                    {g?.refundedAt != null && (
                      <span className="text-[11px] text-[#6E6E73]">
                        {new Date(g.refundedAt).toLocaleString()}
                      </span>
                    )}
                  </div>
                ) : base.status === 'not_installed' ? (
                  <div className="mt-1 border-t border-[#2C2C2E] pt-3">
                    <RefundCta
                      purchase={base}
                      guarantee={g}
                      compact
                      onRefunded={() => setRefundRefresh((v) => v + 1)}
                    />
                  </div>
                ) : null}
                <span className="flex items-center gap-3">
                  {status === 'active' && (
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => {
                        e.stopPropagation()
                        navigate(`/setup/${base.order.id}`)
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.stopPropagation()
                          navigate(`/setup/${base.order.id}`)
                        }
                      }}
                      className="text-[11px] font-semibold text-[#32D74B]"
                    >
                      {t('profile.getConnected')}
                    </span>
                  )}
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation()
                      navigate(`/help?orderId=${base.order.id}`)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.stopPropagation()
                        navigate(`/help?orderId=${base.order.id}`)
                      }
                    }}
                    className="text-[11px] font-semibold text-[#D7FF3F]"
                  >
                    {t('profile.reportProblem')}
                  </span>
                </span>
              </div>
            )
          })}
        </div>
      )}

      {/* Module 15 — language + currency sheets */}
      {langOpen && <LanguageSheet onClose={() => setLangOpen(false)} />}
      {curOpen && <CurrencySheet onClose={() => setCurOpen(false)} />}

      {/* Module 16 — account sheet (signed-in card) */}
      {accountOpen && <AccountSheet onClose={() => setAccountOpen(false)} />}

      <div className="mt-6 flex gap-2 rounded-[14px] bg-[#1C1C1E] p-3 text-[11px] leading-relaxed text-[#6E6E73]">
        <Info size={14} className="mt-0.5 shrink-0" />
        <span>
          {t('profile.storageNote')}
        </span>
      </div>

      <details className="mt-4 rounded-[14px] bg-[#1C1C1E] p-4">
        <summary className="cursor-pointer text-xs font-semibold text-[#9A9A9E]">
          {t('profile.diagnostics', { count: analytics.length })}
        </summary>
        <ul className="mt-3 flex flex-col gap-1 font-mono text-[11px] text-[#6E6E73]">
          {analytics.length === 0 && <li>{t('profile.noEvents')}</li>}
          {analytics.map((e, i) => (
            <li key={i}>
              {new Date(e.t).toLocaleTimeString()} · {e.event}{' '}
              {e.data ? JSON.stringify(e.data) : ''}
            </li>
          ))}
        </ul>
      </details>
    </div>
  )
}
