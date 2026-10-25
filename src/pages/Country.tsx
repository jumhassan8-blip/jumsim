import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router'
import { PhoneCall, Sheet } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { provider } from '../providers'
import { cachePlans } from '../lib/plan-cache'
import { loadPricing } from '../data/pricing'
import { useStore } from '../state/StoreContext'
import { usePrice } from '../lib/use-price'
import { track } from '../lib/analytics'
import { shareOrCopy } from '../lib/deeplink'
import { FlowHeader, SkeletonRows, ErrorState, FiveGChip } from '../components/ui-bits'
import { PlanGroup } from '../components/PlanGroupRows'
import StoreCta from '../components/StoreCta'
import type { Plan } from '../types'

export default function Country() {
  const { slug = '' } = useParams()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const price = usePrice()
  const { countryBySlug, toast } = useStore()
  const country = countryBySlug(slug)

  const [plans, setPlans] = useState<Plan[] | null>(null)
  const [error, setError] = useState(false)
  const [rates, setRates] = useState<{ mobile: number; landline: number } | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const trackedRef = useRef<string | null>(null)

  const load = () => {
    setPlans(null)
    setError(false)
    // populate the shared plan cache — checkout reads this, never re-fetches
    const planP = provider.getProducts(slug).then((ps) => {
      cachePlans(slug, ps)
      setPlans(ps)
    })
    const ratesP = country?.isBundle
      ? Promise.resolve(null)
      : loadPricing().then((p) => {
          const e = country ? p.countries[country.iso2] : undefined
          return e ? e.callRates : null
        })
    Promise.all([planP, ratesP])
      .then(([, r]) => {
        setRates(r)
        provider.getProducts(slug).then((ps) => {
          const preselect = searchParams.get('plan')
          const initial =
            (preselect && ps.find((p) => p.id === preselect)) ||
            ps.find((p) => p.tag === 'BESTSELLER') ||
            ps.find((p) => p.group === 'unlimited') ||
            ps[0]
          setSelectedId(initial?.id ?? null)
          if (initial && trackedRef.current !== initial.id) {
            trackedRef.current = initial.id
            track('plan_view', { planId: initial.id, source: 'country' })
          }
        })
      })
      .catch(() => setError(true))
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [slug])

  const unlimited = useMemo(
    () => plans?.filter((p) => p.group === 'unlimited') ?? [],
    [plans],
  )
  const data = useMemo(() => plans?.filter((p) => p.group === 'data') ?? [], [plans])
  const selected = plans?.find((p) => p.id === selectedId) ?? null

  const onSelect = (plan: Plan) => {
    setSelectedId(plan.id)
    if (trackedRef.current !== plan.id) {
      trackedRef.current = plan.id
      track('plan_view', { planId: plan.id, source: 'country' })
    }
  }

  return (
    <div className="flex min-h-dvh flex-col bg-[#0A0A0A]">
      <FlowHeader
        title={country ? country.name : t('country.destination')}
        onBack={() => navigate(-1)}
        onShare={
          country
            ? () => {
                shareOrCopy(t('country.shareSubject', { name: country.name }), `/country/${country.slug}`).then(
                  (r) => toast(t(r === 'shared' ? 'country.linkShared' : 'country.linkCopied'), 'success'),
                )
              }
            : undefined
        }
      />

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pt-4">
        {country && (
          <div className="mb-4 flex items-center gap-4 rounded-[14px] bg-[#1C1C1E] p-4">
            <span className="text-4xl" role="img" aria-label={t('common.flag', { name: country.name })}>
              {country.flag}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-semibold text-white">{country.name}</h2>
                {country.fiveG && <FiveGChip />}
              </div>
              <p className="mt-0.5 text-xs text-[#9A9A9E]">
                {country.networks.join(' · ')}
              </p>
              {country.coverageNote && (
                <p className="mt-0.5 text-xs text-[#6E6E73]">{country.coverageNote}</p>
              )}
            </div>
          </div>
        )}

        {plans === null && !error && <SkeletonRows count={5} tall />}
        {error && (
          <ErrorState
            message={t('country.plansError')}
            onRetry={load}
          />
        )}

        {plans && (
          <div className="flex flex-col gap-6 pb-6">
            <PlanGroup
              title={t('country.groupUnlimited')}
              plans={unlimited}
              selectedId={selectedId}
              onSelect={onSelect}
              infoText={t('country.unlimitedInfo')}
            />
            <PlanGroup
              title={t('country.groupData')}
              plans={data}
              selectedId={selectedId}
              onSelect={onSelect}
            />
          </div>
        )}
      </main>

      {/* bottom bar: plan CTA + Module 3 call rates */}
      {(selected || rates) && (
        <div className="sticky bottom-0 z-30 border-t border-[#2A2A2C] bg-[#0A0A0A]/95 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur-md">
          <div className="mx-auto flex max-w-3xl flex-col gap-3">
            {selected && <StoreCta planId={selected.id} />}

            {/* Module 3 — local call rates + VoIP dialer entry */}
            {rates && (
              <div className="flex items-center gap-2 rounded-[14px] bg-[#1C1C1E] p-3">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-[#9A9A9E]">{t('country.callRates')}</p>
                  <p className="mt-0.5 text-sm text-white">
                    {t('country.rateMobile', { price: price(rates.mobile) })}
                    {' · '}
                    {t('country.rateLandline', { price: price(rates.landline) })}
                  </p>
                </div>
                <button
                  onClick={() => setSheetOpen(true)}
                  className="min-h-[44px] shrink-0 rounded-full px-3 text-xs font-semibold text-[#D7FF3F] active:bg-[#2C2C2E]"
                >
                  {t('country.seeDetails')}
                </button>
                <button
                  onClick={() => navigate(`/call/${slug}`)}
                  className="flex min-h-[44px] shrink-0 items-center gap-2 rounded-full bg-[#2C2C2E] px-4 text-xs font-semibold text-white active:bg-[#3A3A3C]"
                >
                  <PhoneCall size={14} /> {t('country.callViaApp')}
                </button>
              </div>
            )}
          </div>

          {sheetOpen && rates && (
            <div
              className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4"
              onClick={() => setSheetOpen(false)}
            >
              <div
                className="w-full max-w-md rounded-3xl bg-[#1C1C1E] p-5"
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-label={t('country.rateSheetLabel')}
              >
                <div className="mb-3 flex items-center gap-2">
                  <Sheet size={16} className="text-[#D7FF3F]" />
                  <h3 className="text-base font-semibold text-white">
                    {t('country.rateSheetTitle', { name: country?.name ?? '' })}
                  </h3>
                </div>
                <div className="flex flex-col divide-y divide-[#2C2C2E] text-sm">
                  {[
                    [t('country.rateMobiles'), price(rates.mobile)],
                    [t('country.rateLandlines'), price(rates.landline)],
                    [t('country.rateHome'), price(Math.round(rates.mobile * 3 * 100) / 100)],
                    [t('country.rateIncoming'), price(0)],
                    [t('country.rateSms'), t('country.rateSmsNA')],
                  ].map(([k, v]) => (
                    <div key={k} className="flex items-center justify-between py-2.5">
                      <span className="text-[#9A9A9E]">{k}</span>
                      <span className="font-semibold text-white">{v}</span>
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-[11px] leading-relaxed text-[#6E6E73]">
                  {t('country.rateNote')}
                </p>
                <button
                  onClick={() => setSheetOpen(false)}
                  className="mt-4 min-h-[48px] w-full rounded-2xl bg-[#D7FF3F] text-sm font-semibold text-black"
                >
                  {t('common.done')}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
