import { useMemo, useState } from 'react'
import { Search, X } from 'lucide-react'
import type { CallRate } from '../types'
import { formatUSD } from '../lib/money'
import { flagFor } from '../lib/flags'

interface Props {
  rates: CallRate[]
  selectedIso2: string
  onPick: (rate: CallRate) => void
  onClose: () => void
}

/** Searchable destination picker — flag, name, dial code and rate per row. */
export default function CountryPicker({ rates, selectedIso2, onPick, onClose }: Props) {
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rates
    return rates.filter(
      (r) =>
        r.country.toLowerCase().includes(q) ||
        r.iso2.toLowerCase() === q ||
        r.dialCode.includes(q.replace(/^\+/, '') ? q : q),
    )
  }, [rates, query])

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end bg-black/60 sm:items-center"
      onClick={onClose}
      role="dialog"
      aria-label="Choose destination"
    >
      <div
        className="flex max-h-[80dvh] w-full flex-col rounded-t-3xl bg-[#1C1C1E] pb-[max(1rem,env(safe-area-inset-bottom))] sm:max-w-md sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 pb-2">
          <p className="text-base font-semibold text-white">Call destination</p>
          <button
            onClick={onClose}
            aria-label="Close picker"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-[#2C2C2E] text-[#9A9A9E] active:bg-[#3A3A3C]"
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-4 pb-2">
          <div className="flex items-center gap-2 rounded-xl bg-[#2C2C2E] px-3 ring-1 ring-[#3A3A3C] focus-within:ring-2 focus-within:ring-[#D7FF3F]">
            <Search size={16} className="shrink-0 text-[#9A9A9E]" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search country or dial code"
              aria-label="Search destination"
              className="h-11 w-full bg-transparent text-sm text-white placeholder-[#6E6E73] outline-none"
            />
          </div>
        </div>

        <ul className="flex-1 overflow-y-auto px-2 pb-2" role="listbox" aria-label="Destinations">
          {filtered.map((r) => (
            <li key={r.iso2}>
              <button
                role="option"
                aria-selected={r.iso2 === selectedIso2}
                onClick={() => {
                  onPick(r)
                  onClose()
                }}
                className={`flex min-h-[52px] w-full items-center gap-3 rounded-xl px-3 text-left active:bg-[#2C2C2E] ${
                  r.iso2 === selectedIso2 ? 'bg-[#D7FF3F]/10' : ''
                }`}
              >
                <span className="text-xl">{flagFor(r.iso2)}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-white">
                    {r.country}
                  </span>
                  <span className="block text-xs text-[#9A9A9E]">{r.dialCode}</span>
                </span>
                <span className="text-xs font-semibold text-[#D7FF3F]">
                  {formatUSD(r.mobilePerMin)}/min
                </span>
              </button>
            </li>
          ))}
          {filtered.length === 0 && (
            <li className="p-6 text-center text-sm text-[#9A9A9E]">No country matches “{query}”</li>
          )}
        </ul>
      </div>
    </div>
  )
}
