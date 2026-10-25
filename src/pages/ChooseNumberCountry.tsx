import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { Search, ShieldCheck, Zap } from 'lucide-react'
import { loadPricing } from '../data/pricing'
import { useStore } from '../state/StoreContext'
import { track } from '../lib/analytics'
import { formatUSD } from '../lib/money'
import { FlowHeader, SkeletonRows } from '../components/ui-bits'

interface Row {
  iso: string
  name: string
  flag: string
  dialCode: string
  monthlyUSD: number | null
  kycRequired: boolean
  soldOut: boolean
}

export default function ChooseNumberCountry() {
  const navigate = useNavigate()
  const { catalog, purchases } = useStore()
  const [rows, setRows] = useState<Row[] | null>(null)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string | null>(null)

  const flagOf = useMemo(() => {
    const m = new Map<string, string>()
    for (const c of catalog) m.set(c.iso2, c.flag)
    return m
  }, [catalog])
  const nameOf = useMemo(() => {
    const m = new Map<string, string>()
    for (const c of catalog) m.set(c.iso2, c.name)
    return m
  }, [catalog])

  useEffect(() => {
    let alive = true
    loadPricing().then((p) => {
      if (!alive) return
      setRows(
        Object.keys(p.numberRental.countries)
          .map((iso) => ({
            iso,
            name: nameOf.get(iso) ?? iso,
            flag: flagOf.get(iso) ?? '🏳️',
            dialCode: p.dialCodes[iso]?.dialCode ?? '',
            monthlyUSD: p.numberRental.soldOut.includes(iso)
              ? null
              : p.numberRental.countries[iso].monthlyUSD,
            kycRequired: p.numberRental.countries[iso].kycRequired,
            soldOut: p.numberRental.soldOut.includes(iso),
          }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      )
    })
    return () => {
      alive = false
    }
  }, [flagOf, nameOf])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!rows) return []
    return rows.filter(
      (r) =>
        q === '' ||
        r.name.toLowerCase().includes(q) ||
        r.dialCode.includes(q) ||
        r.iso.toLowerCase() === q,
    )
  }, [rows, query])

  // quick-pick: the country of the user's most recent eSIM purchase
  const lastEsimIso = purchases[0]?.country.iso2 ?? null
  const quickPick = rows?.find((r) => r.iso === lastEsimIso && !r.soldOut) ?? null

  const pick = (iso: string) => {
    setSelected(iso)
    const row = rows?.find((r) => r.iso === iso)
    track('number_country_viewed', { country: iso, dialCode: row?.dialCode ?? '' })
  }

  const selectedRow = rows?.find((r) => r.iso === selected)

  return (
    <div className="flex min-h-dvh flex-col bg-[#0A0A0A]">
      <FlowHeader title="Choose your number" onBack={() => navigate(-1)} />

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 pt-4">
        <p className="mb-4 text-sm leading-relaxed text-[#9A9A9E]">
          Rent a local number to use as your caller ID. Numbers are{' '}
          <span className="font-semibold text-white">rented monthly</span>, never sold —
          cancel any time.
        </p>

        {quickPick && (
          <button
            onClick={() => pick(quickPick.iso)}
            className={`mb-4 flex min-h-[56px] w-full items-center gap-3 rounded-[14px] p-4 text-left ring-1 transition-colors ${
              selected === quickPick.iso
                ? 'bg-[#1C1C1E] ring-2 ring-[#D7FF3F]'
                : 'bg-[#1C1C1E] ring-[#2C2C2E] active:bg-[#2C2C2E]'
            }`}
          >
            <span className="text-2xl">{quickPick.flag}</span>
            <span className="flex-1">
              <span className="flex items-center gap-1.5 text-sm font-semibold text-white">
                <Zap size={14} className="text-[#D7FF3F]" />
                Use same as my eSIM
              </span>
              <span className="block text-xs text-[#9A9A9E]">
                {quickPick.name} · {quickPick.dialCode}
              </span>
            </span>
            <span className="text-sm font-semibold text-[#D7FF3F]">
              {quickPick.monthlyUSD !== null ? `${formatUSD(quickPick.monthlyUSD)}/mo` : ''}
            </span>
          </button>
        )}

        <div className="mb-3 flex h-12 items-center gap-2 rounded-2xl bg-[#1C1C1E] px-4 ring-1 ring-[#2C2C2E] focus-within:ring-2 focus-within:ring-[#D7FF3F]">
          <Search size={18} className="shrink-0 text-[#9A9A9E]" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search country or dial code"
            aria-label="Search country"
            className="h-full w-full bg-transparent text-sm text-white placeholder-[#6E6E73] outline-none"
          />
        </div>

        {!rows && <SkeletonRows count={8} />}

        {rows && (
          <ul className="flex flex-col gap-2 pb-40">
            {visible.map((r) => (
              <li key={r.iso}>
                <button
                  onClick={() => (r.soldOut ? undefined : pick(r.iso))}
                  disabled={r.soldOut}
                  aria-pressed={selected === r.iso}
                  className={`flex min-h-[56px] w-full items-center gap-3 rounded-[14px] p-4 text-left transition-colors ${
                    r.soldOut
                      ? 'bg-[#161617] opacity-50'
                      : selected === r.iso
                        ? 'bg-[#1C1C1E] ring-2 ring-[#D7FF3F]'
                        : 'bg-[#1C1C1E] ring-1 ring-[#2C2C2E] active:bg-[#2C2C2E]'
                  }`}
                >
                  <span className="text-2xl">{r.flag}</span>
                  <span className="flex-1">
                    <span className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-white">
                      {r.name}
                      {r.dialCode && (
                        <span className="rounded-full bg-[#2C2C2E] px-2 py-0.5 text-[10px] font-semibold text-[#9A9A9E]">
                          {r.dialCode}
                        </span>
                      )}
                      {r.kycRequired && (
                        <span className="inline-flex items-center gap-0.5 rounded-full bg-[#D7FF3F]/10 px-2 py-0.5 text-[10px] font-semibold text-[#D7FF3F]">
                          <ShieldCheck size={10} /> ID check
                        </span>
                      )}
                    </span>
                    <span className="block text-xs text-[#9A9A9E]">
                      {r.soldOut ? 'Sold out — join waitlist' : 'Monthly rental'}
                    </span>
                  </span>
                  <span className="text-sm font-semibold text-white">
                    {r.monthlyUSD !== null ? `${formatUSD(r.monthlyUSD)}/mo` : '—'}
                  </span>
                </button>
              </li>
            ))}
            {visible.length === 0 && (
              <li className="py-10 text-center text-sm text-[#6E6E73]">
                No countries match “{query}”
              </li>
            )}
          </ul>
        )}
      </main>

      {/* sticky CTA */}
      <div className="fixed inset-x-0 bottom-0 z-40 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
        <div className="mx-auto max-w-3xl">
          <button
            disabled={!selected}
            onClick={() => {
              if (!selectedRow) return
              navigate(
                `/number/pick?iso=${selectedRow.iso}&soldOut=${selectedRow.soldOut ? 1 : 0}`,
              )
            }}
            className="flex min-h-[56px] w-full items-center justify-center rounded-2xl bg-[#D7FF3F] text-base font-semibold text-black transition-opacity active:opacity-80 disabled:opacity-30"
          >
            {selectedRow?.soldOut
              ? 'Join waitlist'
              : selectedRow
                ? `Continue · ${selectedRow.name} ${selectedRow.dialCode}`
                : 'Select a country'}
          </button>
        </div>
      </div>
    </div>
  )
}
