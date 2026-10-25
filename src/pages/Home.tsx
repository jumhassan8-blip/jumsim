import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { Search, X, SignalHigh, Zap, QrCode, ShieldCheck } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useStore } from '../state/StoreContext'
import { provider } from '../providers'
import type { Plan } from '../types'
import { formatPlanSize } from '../lib/money'
import { usePrice } from '../lib/use-price'
import { track } from '../lib/analytics'
import { PopularCard } from '../components/CountryCard'
import { SectionTitle, SkeletonRows, ErrorState } from '../components/ui-bits'
import { FiveGChip, Badge } from '../components/ui-bits'

/** bundles featured in "Recommended plans" + their highlight plan */
const FEATURED: Array<{ slug: string; pick: (p: Plan[]) => Plan | undefined }> = [
  { slug: 'europe', pick: (ps) => ps.find((p) => p.dataGB === 10) },
  { slug: 'asia-pacific', pick: (ps) => ps.find((p) => p.dataGB === 5) },
  { slug: 'global', pick: (ps) => ps.find((p) => p.dataGB === 10) },
]

export default function Home() {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const price = usePrice()
  const { catalog, catalogStatus, reloadCatalog } = useStore()
  const [query, setQuery] = useState('')
  const [planCounts, setPlanCounts] = useState<Record<string, number>>({})
  const [featured, setFeatured] = useState<Array<{ plan: Plan; flag: string; name: string }>>([])
  const searchTimer = useRef<number | null>(null)

  const popular = useMemo(
    () => catalog.filter((c) => c.popular).slice(0, 8),
    [catalog],
  )

  // fetch real plan counts for the popular rail + featured bundle plans
  useEffect(() => {
    let alive = true
    const slugs = ['japan', 'united-states', 'indonesia', 'thailand', 'united-kingdom']
    const countsP = Promise.all(
      slugs.map((s) => provider.getProducts(s).then((ps) => [s, ps.length] as const)),
    )
    const featuredP = Promise.all(
      FEATURED.map((f) =>
        provider.getProducts(f.slug).then((ps) => {
          const plan = f.pick(ps)
          const country = catalog.find((c) => c.slug === f.slug)
          return plan && country ? { plan, flag: country.flag, name: country.name } : null
        }),
      ),
    )
    Promise.all([countsP, featuredP])
      .then(([counts, feats]) => {
        if (!alive) return
        setPlanCounts(Object.fromEntries(counts))
        setFeatured(feats.filter((f): f is NonNullable<typeof f> => f !== null))
      })
      .catch(() => {
        /* featured section just stays empty — main catalog still renders */
      })
    return () => {
      alive = false
    }
  }, [catalog])

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (q.length < 2) return []
    return catalog
      .filter((c) => c.name.toLowerCase().includes(q))
      .slice(0, 12)
  }, [query, catalog])

  const onSearch = (value: string) => {
    setQuery(value)
    if (searchTimer.current) window.clearTimeout(searchTimer.current)
    const v = value.trim()
    if (v.length >= 2) {
      searchTimer.current = window.setTimeout(
        () => track('search', { query: v, results: results.length }),
        600,
      )
    }
  }

  const goCountry = (slug: string) => navigate(`/country/${slug}`)

  return (
    <div className="mx-auto max-w-5xl px-4 pb-32 pt-6">
      {/* header */}
      <header className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight text-white">{t('home.brand')}</h1>
        <p className="text-sm text-[#9A9A9E]">{t('home.tagline')}</p>
      </header>

      {/* search */}
      <div className="mb-6">
        <div className="flex h-12 items-center gap-2 rounded-2xl bg-[#1C1C1E] px-4 ring-1 ring-[#2C2C2E] focus-within:ring-2 focus-within:ring-[#D7FF3F]">
          <Search size={18} className="shrink-0 text-[#9A9A9E]" />
          <input
            value={query}
            onChange={(e) => onSearch(e.target.value)}
            placeholder={t('home.searchPlaceholder')}
            aria-label={t('common.searchCountries')}
            className="min-w-0 flex-1 bg-transparent text-sm text-white placeholder-[#6E6E73] outline-none"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              aria-label={t('common.clearSearch')}
              className="flex h-8 w-8 items-center justify-center rounded-full text-[#9A9A9E] active:bg-[#2C2C2E]"
            >
              <X size={16} />
            </button>
          )}
        </div>

        {/* live results */}
        {query.trim().length >= 2 && (
          <div className="mt-3 flex flex-col gap-2">
            {results.length === 0 && (
              <p className="rounded-[14px] bg-[#1C1C1E] px-4 py-6 text-center text-sm text-[#9A9A9E]">
                {t('home.noResults', { query })}
              </p>
            )}
            {results.map((c) => (
              <button
                key={c.slug}
                onClick={() => goCountry(c.slug)}
                className="flex min-h-[56px] items-center gap-3 rounded-[14px] bg-[#1C1C1E] px-4 text-left transition-colors active:bg-[#2C2C2E]"
              >
                <span className="text-2xl">{c.flag}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-white">
                    {c.name}
                  </span>
                  <span className="block text-xs text-[#9A9A9E]">
                    {c.isBundle ? t('home.multiCountry') : t('home.dataPlansFrom', { price: price(4.99) })}
                  </span>
                </span>
                {c.fiveG && <FiveGChip />}
              </button>
            ))}
          </div>
        )}
      </div>

      {query.trim().length >= 2 ? null : catalogStatus === 'loading' ? (
        <SkeletonRows count={5} tall />
      ) : catalogStatus === 'error' ? (
        <ErrorState
          message={t('home.catalogError')}
          onRetry={reloadCatalog}
        />
      ) : (
        <>
          {/* popular destinations */}
          <section className="mb-8">
            <SectionTitle
              action={
                <button
                  onClick={() => navigate('/explore')}
                  className="text-xs font-semibold text-[#D7FF3F]"
                >
                  {t('home.seeAll')}
                </button>
              }
            >
              {t('home.popularDestinations')}
            </SectionTitle>
            <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {popular.map((c) => (
                <PopularCard
                  key={c.slug}
                  country={c}
                  planCount={planCounts[c.slug] ?? 5}
                  onClick={() => goCountry(c.slug)}
                />
              ))}
            </div>
          </section>

          {/* recommended plans */}
          <section className="mb-8">
            <SectionTitle>{t('home.recommendedPlans')}</SectionTitle>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {featured.length === 0 && <SkeletonRows count={3} tall />}
              {featured.map(({ plan, flag, name }) => (
                <button
                  key={plan.id}
                  onClick={() => {
                    track('plan_view', { planId: plan.id, source: 'home' })
                    navigate(`/country/${plan.countrySlug}?plan=${plan.id}`)
                  }}
                  className="relative flex flex-col gap-3 rounded-[14px] bg-[#1C1C1E] p-4 text-left transition-colors active:bg-[#2C2C2E]"
                >
                  {plan.badge && (
                    <span className="absolute right-3 top-3">
                      <Badge>{plan.badge === 'popular' ? t('home.badgePopular') : t('home.badgeBestseller')}</Badge>
                    </span>
                  )}
                  <span className="text-3xl">{flag}</span>
                  <div>
                    <p className="text-sm font-semibold text-white">{name}</p>
                    <p className="mt-1 text-xs text-[#9A9A9E]">
                      {t('home.planMeta', { size: formatPlanSize(plan.dataGB), days: plan.days })}
                    </p>
                  </div>
                  <div className="mt-auto flex items-center justify-between">
                    <span className="text-lg font-semibold text-[#D7FF3F]">
                      {price(plan.priceUSD)}
                    </span>
                    {plan.fiveG && <FiveGChip />}
                  </div>
                </button>
              ))}
            </div>
          </section>

          {/* trust strip */}
          <section className="rounded-[14px] bg-[#1C1C1E] p-4">
            <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs font-medium text-[#9A9A9E]">
              <span className="inline-flex items-center gap-1.5">
                <SignalHigh size={14} className="text-[#D7FF3F]" /> {t('home.trustCountries')}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Zap size={14} className="text-[#D7FF3F]" /> {t('home.trust5g')}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <QrCode size={14} className="text-[#D7FF3F]" /> {t('home.trustInstall')}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <ShieldCheck size={14} className="text-[#D7FF3F]" /> {t('home.trustRefund')}
              </span>
            </div>
            <p className="mt-3 text-center text-[11px] text-[#6E6E73]">
              {t('home.trustFootnote')}
            </p>
          </section>
        </>
      )}
    </div>
  )
}
