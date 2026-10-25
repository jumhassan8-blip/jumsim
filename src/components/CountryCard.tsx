import { ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { Country } from '../types'
import { FiveGChip } from './ui-bits'

/** wide horizontal card for the Home "Popular destinations" rail */
export function PopularCard({
  country,
  planCount,
  onClick,
}: {
  country: Country
  planCount: number
  onClick: () => void
}) {
  const { t } = useTranslation()
  return (
    <button
      onClick={onClick}
      className="flex w-36 shrink-0 flex-col gap-2 rounded-[14px] bg-[#1C1C1E] p-4 text-left transition-colors active:bg-[#2C2C2E]"
    >
      <span className="text-3xl" role="img" aria-label={t('common.flag', { name: country.name })}>
        {country.flag}
      </span>
      <span className="text-sm font-semibold leading-tight text-white">
        {country.slug === 'indonesia' ? 'Bali' : country.name}
      </span>
      <span className="text-xs text-[#9A9A9E]">{t('home.plansCount', { count: planCount })}</span>
    </button>
  )
}

/** compact list row for Explore / search results */
export function CountryRow({
  country,
  planCount,
  subtitle,
  onClick,
}: {
  country: Country
  /** when set, shown as "N+ plans"; otherwise `subtitle` (or region) is shown */
  planCount?: number
  subtitle?: string
  onClick: () => void
}) {
  const { t } = useTranslation()
  return (
    <button
      onClick={onClick}
      className="flex min-h-[44px] w-full items-center gap-3 rounded-[14px] bg-[#1C1C1E] px-4 py-3 text-left transition-colors active:bg-[#2C2C2E]"
    >
      <span className="text-2xl" role="img" aria-label={t('common.flag', { name: country.name })}>
        {country.flag}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-white">
          {country.name}
        </span>
        <span className="block text-xs text-[#9A9A9E]">
          {planCount !== undefined
            ? t('home.plansCountBundle', {
                count: planCount,
                bundle: country.isBundle ? t('home.multiCountryShort') : '',
              })
            : (subtitle ?? country.region)}
        </span>
      </span>
      {country.fiveG && <FiveGChip />}
      <ChevronRight size={18} className="shrink-0 text-[#9A9A9E] flip-rtl" />
    </button>
  )
}
