/**
 * Price formatting hook — binds the FX state (currency + rate) to the
 * active UI locale so prices re-render on language/currency switches.
 */
import { useTranslation } from 'react-i18next'
import { useFx, formatLocalPrice, formatApproxUSD, type FxState } from './fx'
import { formatLocale } from '../i18n'

export interface PriceFormatter {
  (usd: number): string
  fx: FxState
  locale: string
  usd: (usd: number) => string
}

export function usePrice(): PriceFormatter {
  const fx = useFx()
  const { i18n } = useTranslation()
  const locale = formatLocale(i18n.language)
  const fmt = ((usd: number) => formatLocalPrice(usd, fx, locale)) as PriceFormatter
  fmt.fx = fx
  fmt.locale = locale
  fmt.usd = formatApproxUSD
  return fmt
}
