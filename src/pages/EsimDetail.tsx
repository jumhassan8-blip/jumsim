import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { Plus, ListChecks } from 'lucide-react'
import { provider } from '../providers'
import { useStore } from '../state/StoreContext'
import type { Plan, Usage } from '../types'
import { mergeUsage, groupByIccid, displayStatus, DAY_MS } from '../lib/usage'
import { useGuarantee } from '../lib/guarantee'
import RefundCta from '../components/RefundCta'
import { formatUSD, formatPlanSize } from '../lib/money'
import { readOrderSetupLog } from '../lib/setup'
import { checkoutConfigured, openStoreCheckout } from '../lib/checkout-link'
import { FlowHeader, SkeletonRows, ErrorState } from '../components/ui-bits'
import StatusChip from '../components/StatusChip'
import InstallPanel from '../components/InstallPanel'

function fmtMB(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)}GB`
  return `${Math.round(mb)}MB`
}

export default function EsimDetail() {
  const { t } = useTranslation()
  const { iccid = '' } = useParams()
  const navigate = useNavigate()
  const { purchases } = useStore()
  const [now, setNow] = useState(Date.now())
  const [topUps, setTopUps] = useState<Plan[] | null>(null)
  const [plansError, setPlansError] = useState(false)

  const group = useMemo(
    () => groupByIccid(purchases).find((g) => g.base.order.iccid === iccid),
    [purchases, iccid],
  )

  // Server-authoritative usage: fetch /api/usage for this eSIM (and its
  // top-ups) and render exactly what the provider reports. Fail closed —
  // a fetch failure leaves used at 0 and flags an honest error state,
  // never a fabricated number.
  const [usageReadings, setUsageReadings] = useState<Map<string, Usage> | null>(null)
  const [usageError, setUsageError] = useState(false)
  useEffect(() => {
    if (!group) return
    let alive = true
    const all = [group.base, ...group.topUps]
    Promise.all(
      all.map((p) =>
        provider.getUsage(p.order.iccid, p).then(
          (u) => [p.order.iccid, u] as const,
          () => null,
        ),
      ),
    )
      .then((results) => {
        if (!alive) return
        const failed = results.some((r) => r === null)
        setUsageError(failed)
        setUsageReadings(new Map(results.filter((r): r is readonly [string, Usage] => r !== null)))
      })
    return () => {
      alive = false
    }
  }, [group])

  const loadTopUps = () => {
    if (!group) return
    setTopUps(null)
    setPlansError(false)
    provider
      .getProducts(group.base.country.slug)
      .then((ps) =>
        setTopUps(
          // top-ups: same country, exclude the exact plan already active
          ps.filter((p) => p.id !== group.base.plan.id),
        ),
      )
      .catch(() => setPlansError(true))
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(loadTopUps, [iccid, purchases])

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(t)
  }, [])

  if (!group) {
    return (
      <div className="min-h-dvh bg-[#0A0A0A]">
        <FlowHeader title="eSIM" onBack={() => navigate('/profile')} />
        <main className="mx-auto max-w-3xl px-4 pt-4">
          <ErrorState
            message="This eSIM isn't stored on this device."
            onRetry={() => navigate('/profile')}
          />
        </main>
      </div>
    )
  }

  const { base, topUps: topUpPurchases } = group
  // server-authoritative refund state (window countdown / refunded chip)
  const guarantee = useGuarantee([base.order.id])[base.order.id]
  const usage = mergeUsage(base, topUpPurchases, now, usageReadings ?? undefined)
  const status = displayStatus(base, topUpPurchases, now)
  const pct = Math.min(100, Math.round((usage.usedMB / usage.totalMB) * 100))
  const daysLeft = Math.ceil((usage.expiresAt - now) / DAY_MS)
  const all = [base, ...topUpPurchases]

  return (
    <div className="flex min-h-dvh flex-col bg-[#0A0A0A]">
      <FlowHeader title={base.country.name} onBack={() => navigate('/profile')} />

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pt-4">
        {/* overview card */}
        <section className="mb-4 rounded-[14px] bg-[#1C1C1E] p-4">
          <div className="mb-3 flex items-center gap-3">
            <span className="text-3xl">{base.country.flag}</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-white">
                {formatPlanSize(base.plan.dataGB)} · {base.plan.days} days
              </p>
              <p className="font-mono text-xs text-[#6E6E73]">ICCID {base.order.iccid}</p>
            </div>
            {base.status === 'refunded' || guarantee?.status === 'refunded_terminated' ? (
              <span className="rounded-full bg-[#3A3A3C] px-2.5 py-1 text-[10px] font-bold text-[#9A9A9E]">
                {t('refund.refundedTerminated')}
              </span>
            ) : null}
            <StatusChip status={status} />
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-[#2C2C2E]">
            <div
              className={`h-full rounded-full ${pct > 90 ? 'bg-[#FF453A]' : 'bg-[#D7FF3F]'}`}
              style={{ width: `${Math.max(2, pct)}%` }}
            />
          </div>
          <div className="mt-2 flex items-center justify-between text-xs text-[#9A9A9E]">
            <span>
              {usageError
                ? 'Usage unavailable — pull to refresh or contact support'
                : `${fmtMB(usage.usedMB)} used of ${usage.fairUseCapMB ? `${fmtMB(usage.fairUseCapMB)} high-speed (fair-use)` : fmtMB(usage.totalMB)}`}
            </span>
            <span>{status === 'expired' ? 'Expired' : `${Math.max(0, daysLeft)}d left`}</span>
          </div>
          <p className="mt-3 text-xs text-[#6E6E73]">
            Valid until {new Date(usage.expiresAt).toLocaleDateString()} · bought{' '}
            {new Date(base.order.createdAt).toLocaleDateString()}
          </p>
          {base.status === 'not_installed' && (
            <div className="mt-3 border-t border-[#2C2C2E] pt-3">
              <RefundCta purchase={base} guarantee={guarantee} compact />
            </div>
          )}
        </section>

        {/* top up */}
        {status === 'active' && base.status !== 'refunded' && (
          <section className="mb-4">
            <h2 className="mb-2 text-sm font-semibold text-[#9A9A9E]">Top up</h2>
            {topUps === null && !plansError && <SkeletonRows count={2} />}
            {plansError && (
              <ErrorState message="Top-ups couldn't be loaded." onRetry={loadTopUps} />
            )}
            {topUps && (
              <div className="flex flex-col gap-2">
                {topUps.map((p) => (
                  <button
                    key={p.id}
                    disabled={!checkoutConfigured}
                    onClick={() =>
                      openStoreCheckout({ planId: p.id, topUpFor: iccid })
                    }
                    className="flex min-h-[64px] items-center gap-3 rounded-[14px] bg-[#1C1C1E] px-4 text-left transition-colors active:bg-[#2C2C2E] disabled:opacity-50"
                  >
                    <Plus size={16} className="shrink-0 text-[#D7FF3F]" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-white">
                        {formatPlanSize(p.dataGB)} · {p.days} days
                      </span>
                      <span className="block text-xs text-[#9A9A9E]">
                        {checkoutConfigured
                          ? p.dataGB === 'unlimited'
                            ? p.fairUseNote
                            : `Adds instantly · keeps your number`
                          : 'Store opening soon'}
                      </span>
                    </span>
                    <span className="text-sm font-semibold text-[#D7FF3F]">
                      {formatUSD(p.priceUSD)}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>
        )}

        {/* reinstall */}
        {status === 'active' && (
          <section className="mb-4">
            <h2 className="mb-2 text-sm font-semibold text-[#9A9A9E]">
              Reinstall on a new device
            </h2>
            <InstallPanel order={base.order} email={base.order.email} />
          </section>
        )}

        {/* connection guide entry */}
        {status === 'active' && (
          <button
            onClick={() => navigate(`/setup/${base.order.id}`)}
            className="mb-4 flex w-full items-center gap-3 rounded-[14px] bg-[#1C1C1E] p-4 text-left"
          >
            <ListChecks size={18} className="text-[#32D74B]" />
            <span className="flex-1 text-sm font-semibold text-white">Get connected</span>
            <span className="text-xs text-[#9A9A9E]">checklist & test</span>
          </button>
        )}

        {/* setup log — support reads this from the order ID */}
        <section className="mb-6">
          <h2 className="mb-2 text-sm font-semibold text-[#9A9A9E]">Setup history</h2>
          <div className="rounded-[14px] bg-[#1C1C1E] p-4">
            {readOrderSetupLog(base.order.id).length === 0 ? (
              <p className="text-xs text-[#6E6E73]">
                No setup activity logged yet. Open “Get connected” to run the checklist.
              </p>
            ) : (
              <ul className="flex flex-col gap-1 font-mono text-[11px] text-[#9A9A9E]">
                {readOrderSetupLog(base.order.id).map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {/* purchase history */}
        <section className="mb-6">
          <h2 className="mb-2 text-sm font-semibold text-[#9A9A9E]">History</h2>
          <div className="flex flex-col gap-2">
            {all.map((p) => (
              <div
                key={p.order.id}
                className="flex items-center gap-3 rounded-[14px] bg-[#1C1C1E] px-4 py-3"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-white">
                    {p.order.topUpFor ? 'Top-up · ' : 'Purchase · '}
                    {formatPlanSize(p.plan.dataGB)} · {p.plan.days} days
                  </span>
                  <span className="block text-xs text-[#6E6E73]">
                    {new Date(p.order.createdAt).toLocaleDateString()} · {p.order.email}
                  </span>
                </span>
                <span className="text-sm font-semibold text-white">
                  {formatUSD(p.plan.priceUSD)}
                </span>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  )
}
