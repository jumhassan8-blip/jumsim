import { useState } from 'react'
import { Info } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { Plan } from '../types'
import { usePrice } from '../lib/use-price'
import { localizedPlanLabel, localizedPlanTag, localizedUnitDisplay } from '../lib/plan-i18n'

function Tag({ text }: { text: string }) {
  return (
    <span className="rounded-md bg-[#D7FF3F] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-black">
      {text}
    </span>
  )
}

/**
 * Module 2 reference row: dark card, name left, price (lime) center,
 * unit rate right, radio select.
 */
function GroupRow({
  plan,
  selected,
  onSelect,
}: {
  plan: Plan
  selected: boolean
  onSelect: (plan: Plan) => void
}) {
  const { t } = useTranslation()
  const price = usePrice()
  const tag = localizedPlanTag(plan.tag, t, (usd) => price(usd))
  return (
    <button
      onClick={() => onSelect(plan)}
      aria-pressed={selected}
      className={`flex min-h-[60px] w-full items-center gap-3 rounded-[14px] bg-[#1C1C1E] px-4 py-3 text-left transition-colors active:bg-[#2C2C2E] ${
        selected ? 'ring-2 ring-[#D7FF3F]' : ''
      } ${plan.group === 'unlimited' ? 'border border-[#D7FF3F]/30' : ''}`}
    >
      <span
        aria-hidden
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
          selected ? 'border-[#D7FF3F]' : 'border-[#6E6E73]'
        }`}
      >
        {selected && <span className="h-2.5 w-2.5 rounded-full bg-[#D7FF3F]" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="text-sm font-semibold text-white">{localizedPlanLabel(plan, t)}</span>
          {tag && <Tag text={tag} />}
        </span>
        {plan.group === 'unlimited' && (
          <span className="mt-0.5 block text-[11px] text-[#6E6E73]">{t('plans.fairUse')}</span>
        )}
      </span>
      <span className="shrink-0 text-base font-semibold text-[#D7FF3F]">
        {price(plan.priceUSD)}
      </span>
      <span className="w-20 shrink-0 text-right text-[11px] text-[#9A9A9E]">
        {localizedUnitDisplay(plan, t, (usd) => price(usd))}
      </span>
    </button>
  )
}

/** one plan group (header + rows); unlimited header carries the FUP ⓘ popover */
export function PlanGroup({
  title,
  plans,
  selectedId,
  onSelect,
  infoText,
}: {
  title: string
  plans: Plan[]
  selectedId: string | null
  onSelect: (plan: Plan) => void
  infoText?: string
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  if (plans.length === 0) return null
  return (
    <section>
      <div className="mb-2 flex items-center gap-1.5 px-1">
        <h2 className="text-sm font-semibold text-[#9A9A9E]">{title}</h2>
        {infoText && (
          <span className="relative">
            <button
              onClick={() => setOpen((v) => !v)}
              onBlur={() => setOpen(false)}
              aria-label={t('plans.fupAria')}
              className="flex h-7 w-7 items-center justify-center rounded-full text-[#9A9A9E] active:bg-[#2C2C2E]"
            >
              <Info size={14} />
            </button>
            {open && (
              <span
                role="tooltip"
                className="absolute left-0 top-8 z-40 block w-64 rounded-xl bg-[#2C2C2E] p-3 text-xs leading-relaxed text-white shadow-xl"
              >
                {infoText}
              </span>
            )}
          </span>
        )}
      </div>
      <div className="flex flex-col gap-2">
        {plans.map((p) => (
          <GroupRow
            key={p.id}
            plan={p}
            selected={p.id === selectedId}
            onSelect={onSelect}
          />
        ))}
      </div>
    </section>
  )
}
