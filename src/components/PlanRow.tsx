import { ChevronRight, Infinity as InfinityIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { Plan } from '../types'
import { usePrice } from '../lib/use-price'
import { Badge } from './ui-bits'

export function perksLine(plan: Plan, t: (k: string) => string): string {
  const perks: string[] = []
  perks.push(t(plan.fiveG ? 'planRow.highSpeed5g' : 'planRow.highSpeed4g'))
  perks.push(t(plan.hotspot ? 'planRow.hotspotYes' : 'planRow.hotspotNo'))
  return perks.join(' · ')
}

export default function PlanRow({
  plan,
  price: retailUSD,
  selected = false,
  onSelect,
}: {
  plan: Plan
  /** retail price with markup applied (USD) */
  price: number
  selected?: boolean
  onSelect: (plan: Plan) => void
}) {
  const { t } = useTranslation()
  const price = usePrice()
  const unlimited = plan.dataGB === 'unlimited'
  return (
    <button
      onClick={() => onSelect(plan)}
      aria-pressed={selected}
      className={`flex min-h-[72px] w-full items-center gap-3 rounded-[14px] bg-[#1C1C1E] p-4 text-left transition-colors active:bg-[#2C2C2E] ${
        selected ? 'ring-2 ring-[#D7FF3F]' : ''
      } ${unlimited ? 'border border-[#D7FF3F]/40' : ''}`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          {unlimited ? (
            <span className="inline-flex items-center gap-1 text-base font-semibold text-white">
              <InfinityIcon size={16} className="text-[#D7FF3F]" /> {t('plans.unlimited')}
            </span>
          ) : (
            <span className="text-base font-semibold text-white">{plan.dataGB}GB</span>
          )}
          <span className="text-base text-[#9A9A9E]">{t('planRow.days', { count: plan.days })}</span>
          {plan.badge === 'bestseller' && <Badge>{t('planRow.badgeBestseller')}</Badge>}
          {plan.badge === 'popular' && <Badge tone="outline">{t('planRow.badgePopular')}</Badge>}
          {unlimited && <Badge tone="outline">{t('planRow.badgeFairUse')}</Badge>}
        </div>
        <p className="mt-1 text-xs text-[#9A9A9E]">
          {unlimited ? t('plans.fairUse') : perksLine(plan, t)}
        </p>
        {unlimited && (
          <p className="mt-0.5 text-xs text-[#9A9A9E]">{perksLine(plan, t)}</p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <span className="text-base font-semibold text-white">{price(retailUSD)}</span>
        <ChevronRight size={18} className="text-[#9A9A9E] flip-rtl" />
      </div>
    </button>
  )
}
