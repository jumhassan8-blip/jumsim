import { useTranslation } from 'react-i18next'
import { Check, Search, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { detectLanguage, LANGUAGE_NAMES, setLanguage, SUPPORTED, type Language } from '../i18n'

/**
 * Profile → Language sheet. Native names, the auto-detected entry marked
 * "Detected", checkmark on the active language. Persists across launches.
 */
export default function LanguageSheet({ onClose }: { onClose: () => void }) {
  const { t, i18n } = useTranslation()
  const [query, setQuery] = useState('')
  const active = i18n.language as Language
  const detected = detectLanguage()

  const list = useMemo(() => {
    const q = query.trim().toLowerCase()
    return SUPPORTED.filter(
      (code) =>
        q === '' ||
        LANGUAGE_NAMES[code].toLowerCase().includes(q) ||
        code.includes(q),
    )
  }, [query])

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60"
      role="dialog"
      aria-modal="true"
      aria-label={t('langPicker.title')}
    >
      <div className="w-full max-w-md rounded-t-[24px] border-t border-[#2C2C2E] bg-[#161618] px-6 pb-8 pt-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-white">{t('langPicker.title')}</h2>
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
            placeholder={t('langPicker.search')}
            aria-label={t('langPicker.search')}
            className="min-w-0 flex-1 bg-transparent text-sm text-white placeholder-[#6E6E73] outline-none"
          />
        </div>

        <div className="flex max-h-[55vh] flex-col gap-1 overflow-y-auto">
          {list.map((code) => {
            const isActive = code === active
            const isDetected = code === detected && code !== active
            return (
              <button
                key={code}
                onClick={() => {
                  if (!isActive) setLanguage(code)
                  onClose()
                }}
                className={`flex min-h-[52px] items-center gap-3 rounded-2xl px-4 text-left transition-colors ${
                  isActive ? 'bg-[#D7FF3F]/10' : 'active:bg-[#2C2C2E]'
                }`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-white">
                    {LANGUAGE_NAMES[code]}
                  </span>
                  {isDetected && (
                    <span className="block text-[11px] text-[#D7FF3F]">
                      {t('langPicker.detected')}
                    </span>
                  )}
                </span>
                {isActive && <Check size={18} className="shrink-0 text-[#D7FF3F]" />}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
