/**
 * Plan-label localization. pricing.json stays English/USD (server price
 * authority); labels, tags and unit rates are REGENERATED at render time:
 *  - "7 Days" / "5 GB"        → plural-aware duration/size strings
 *  - "BESTSELLER" / "BEST VALUE [- $1.67/day]" → localized tag, USD rate
 *    converted for the /day variant
 *  - "1.40 USD/GB"            → per-GB rate in the display currency
 *  - fairUseNote              → one localized sentence
 */
import type { TFunction } from 'i18next'
import type { Plan } from '../types'

export function localizedPlanLabel(plan: Plan, t: TFunction): string {
  if (plan.group === 'unlimited') return t('plans.days', { count: plan.days })
  if (plan.dataGB !== 'unlimited') return t('plans.gb', { gb: plan.dataGB })
  return plan.label
}

const BEST_VALUE_DAILY = /^BEST VALUE - \$([\d.]+)\/day$/

export function localizedPlanTag(
  tag: string | undefined,
  t: TFunction,
  usdPerDay: (usd: number) => string,
): string | null {
  if (!tag) return null
  if (tag === 'BESTSELLER') return t('plans.tagBestseller')
  const m = tag.match(BEST_VALUE_DAILY)
  if (m) return t('plans.tagBestValueDaily', { price: usdPerDay(Number(m[1])) })
  if (tag.startsWith('BEST VALUE')) return t('plans.tagBestValue')
  return tag
}

const USD_PER_GB = /^([\d.]+) USD\/GB$/

export function localizedUnitDisplay(
  plan: Plan,
  t: TFunction,
  localPerGB: (usd: number) => string,
): string {
  if (plan.group === 'unlimited') return t('plans.unlimited')
  const m = (plan.unitDisplay ?? '').match(USD_PER_GB)
  if (m) return t('plans.perGB', { price: localPerGB(Number(m[1])) })
  return plan.unitDisplay ?? ''
}
