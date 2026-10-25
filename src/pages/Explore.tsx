import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { Search, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useStore } from '../state/StoreContext'
import type { Region } from '../types'
import { usePrice } from '../lib/use-price'
import { CountryRow } from '../components/CountryCard'
import { SkeletonRows, ErrorState } from '../components/ui-bits'

const REGION_IDS: Array<Region | 'all'> = [
  'all', 'europe', 'asia-pacific', 'americas', 'middle-east', 'africa', 'oceania',
]

export default function Explore() {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const price = usePrice()
  const { catalog, catalogStatus, reloadCatalog } = useStore()
  const [query, setQuery] = useState('')
  const [region, setRegion] = useState<Region | 'all'>('all')

  const REGION_LABEL: Record<Region | 'all', string> = {
    all: t('explore.regionAll'),
    europe: t('explore.regionEurope'),
    'asia-pacific': t('explore.regionAsiaPacific'),
    americas: t('explore.regionAmericas'),
    'middle-east': t('explore.regionMiddleEast'),
    africa: t('explore.regionAfrica'),
    oceania: t('explore.regionOceania'),
  }

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = catalog.filter(
      (c) =>
        (region === 'all' || c.region === region) &&
        (q === '' || c.name.toLowerCase().includes(q)),
    )
    const map = new Map<string, typeof filtered>()
    for (const c of filtered) {
      const letter = c.name[0]?.toUpperCase() ?? '#'
      const arr = map.get(letter) ?? []
      arr.push(c)
      map.set(letter, arr)
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [catalog, query, region])

  return (
    <div className="mx-auto max-w-5xl px-4 pb-32 pt-6">
      <h1 className="mb-4 text-2xl font-semibold tracking-tight text-white">{t('explore.title')}</h1>
      <p className="mb-4 text-sm text-[#9A9A9E]">
        {t('explore.subtitle', { count: catalog.length, price: price(4.99) })}
      </p>

      <div className="mb-4 flex h-12 items-center gap-2 rounded-2xl bg-[#1C1C1E] px-4 ring-1 ring-[#2C2C2E] focus-within:ring-2 focus-within:ring-[#D7FF3F]">
        <Search size={18} className="shrink-0 text-[#9A9A9E]" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('explore.searchPlaceholder')}
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

      <div className="-mx-4 mb-5 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {REGION_IDS.map((id) => (
          <button
            key={id}
            onClick={() => setRegion(id)}
            className={`min-h-[44px] shrink-0 rounded-full px-4 text-xs font-semibold transition-colors ${
              region === id
                ? 'bg-[#D7FF3F] text-black'
                : 'bg-[#1C1C1E] text-[#9A9A9E] active:bg-[#2C2C2E]'
            }`}
          >
            {REGION_LABEL[id]}
          </button>
        ))}
      </div>

      {catalogStatus === 'loading' ? (
        <SkeletonRows count={8} />
      ) : catalogStatus === 'error' ? (
        <ErrorState
          message={t('home.catalogError')}
          onRetry={reloadCatalog}
        />
      ) : groups.length === 0 ? (
        <p className="rounded-[14px] bg-[#1C1C1E] px-4 py-8 text-center text-sm text-[#9A9A9E]">
          {t('explore.noMatch')}
        </p>
      ) : (
        groups.map(([letter, countries]) => (
          <section key={letter} className="mb-5">
            <h2 className="mb-2 px-1 text-xs font-bold uppercase tracking-widest text-[#6E6E73]">
              {letter}
            </h2>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {countries.map((c) => (
                <CountryRow
                  key={c.slug}
                  country={c}
                  subtitle={c.isBundle ? t('home.multiCountry') : c.coverageNote}
                  onClick={() => navigate(`/country/${c.slug}`)}
                />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  )
}
