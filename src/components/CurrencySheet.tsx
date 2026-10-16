import { useTranslation } from 'react-i18next'
import { Check, Search, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { ALL_CURRENCIES, currencyLabel } from '../lib/currency-data'
import { setCurrency, useFx } from '../lib/fx'
import { formatLocale } from '../i18n'

/**
 * Profile → Currency sheet. "Auto (recommended)" follows the device region;
 * the manual list covers every currency the catalog can resolve to, with
 * names localized via Intl.DisplayNames and a search field.
 */
export default function CurrencySheet({ onClose }: { onClose: () => void }) {
  const { t, i18n } = useTranslation()
  const fx = useFx()
  const [query, setQuery] = useState('')
  const locale = formatLocale(i18n.language)

  const list = useMemo(() => {
    const q = query.trim().toLowerCase()
    return ALL_CURRENCIES.filter(
      (code) =>
        q === '' ||
        code.toLowerCase().includes(q) ||
        currencyLabel(code, locale).toLowerCase().includes(q),
    )
  }, [query, locale])

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60"
      role="dialog"
      aria-modal="true"
      aria-label={t('curPicker.title')}
    >
      <div className="w-full max-w-md rounded-t-[24px] border-t border-[#2C2C2E] bg-[#161618] px-6 pb-8 pt-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-white">{t('curPicker.title')}</h2>
          <button
            onClick={onClose}
            aria-label={t('common.close')}
            className="flex h-9 w-9 items-center justify-center rounded-full text-[#9A9A9E] active:bg-[#2C2C2E]"
          >
            <X size={18} />
          </button>
        </div>

        <div className="mb-3 flex h-11 items-center gap-2 rounded-2xl bg-[#1C1C1E] px-3 ring-1 ring-[#2C2C2E] focus-within:ring-2 focus-within:ring-[#D7FF3F]">
          <Search size={16} className="shrink-0 text-[#9A9A9E]" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('curPicker.search')}
            aria-label={t('curPicker.search')}
            className="min-w-0 flex-1 bg-transparent text-sm text-white placeholder-[#6E6E73] outline-none"
          />
        </div>

        <div className="flex max-h-[55vh] flex-col gap-1 overflow-y-auto">
          <button
            onClick={() => {
              setCurrency('auto')
              onClose()
            }}
            className={`flex min-h-[52px] items-center gap-3 rounded-2xl px-4 text-left transition-colors ${
              fx.override === 'auto' ? 'bg-[#D7FF3F]/10' : 'active:bg-[#2C2C2E]'
            }`}
          >
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-white">
                {t('curPicker.auto')}
              </span>
              <span className="block text-[11px] text-[#9A9A9E]">
                {t('curPicker.autoHint')}
              </span>
            </span>
            {fx.override === 'auto' && <Check size={18} className="shrink-0 text-[#D7FF3F]" />}
          </button>

          {list.map((code) => {
            const isActive = fx.override === code
            return (
              <button
                key={code}
                onClick={() => {
                  setCurrency(code)
                  onClose()
                }}
                className={`flex min-h-[52px] items-center gap-3 rounded-2xl px-4 text-left transition-colors ${
                  isActive ? 'bg-[#D7FF3F]/10' : 'active:bg-[#2C2C2E]'
                }`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-white">
                    {currencyLabel(code, locale)}
                  </span>
                </span>
                {isActive && <Check size={18} className="shrink-0 text-[#D7FF3F]" />}
              </button>
            )
          })}
          {list.length === 0 && (
            <p className="py-6 text-center text-sm text-[#9A9A9E]">{t('curPicker.noMatch')}</p>
          )}
        </div>
      </div>
    </div>
  )
}
