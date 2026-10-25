import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { BellRing, ChevronRight, FileCheck2, MessageSquare, Phone } from 'lucide-react'
import { loadPricing } from '../data/pricing'
import { numberProvider } from '../providers/number'
import { useStore } from '../state/StoreContext'
import { track } from '../lib/analytics'
import { formatUSD } from '../lib/money'
import type { AvailableNumber } from '../types'
import { FlowHeader, SkeletonRows, ErrorState } from '../components/ui-bits'

export default function PickNumber() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const iso = (params.get('iso') ?? '').toUpperCase()
  const soldOut = params.get('soldOut') === '1'
  const { catalog, toast, rentNumber } = useStore()

  const country = catalog.find((c) => c.iso2 === iso)
  const [page, setPage] = useState(1)
  const [numbers, setNumbers] = useState<AvailableNumber[]>([])
  const [loading, setLoading] = useState(!soldOut)
  const [failed, setFailed] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [renting, setRenting] = useState(false)
  const [monthlyUSD, setMonthlyUSD] = useState<number | null>(null)
  const [kycRequired, setKycRequired] = useState(false)
  const [waitlistJoined, setWaitlistJoined] = useState(false)
  const [kycSheetOpen, setKycSheetOpen] = useState(false)
  const [dialCode, setDialCode] = useState('')

  useEffect(() => {
    let alive = true
    loadPricing()
      .then((p) => {
        if (!alive) return
        const e = p.numberRental.countries[iso]
        if (e) {
          setMonthlyUSD(e.monthlyUSD)
          setKycRequired(e.kycRequired)
        }
        setDialCode(p.dialCodes[iso]?.dialCode ?? '')
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [iso])

  const loadPage = useCallback(
    async (pg: number) => {
      setLoading(true)
      setFailed(false)
      try {
        const batch = await numberProvider.getAvailableNumbers(iso, pg)
        setNumbers((prev) => (pg === 1 ? batch : [...prev, ...batch]))
        setHasMore(batch.length === 5)
      } catch {
        setFailed(true)
      } finally {
        setLoading(false)
      }
    },
    [iso],
  )

  useEffect(() => {
    if (!soldOut && iso) void loadPage(1)
  }, [iso, soldOut, loadPage])

  const joinWaitlist = () => {
    // optimistic UI; the server persists the waitlist entry
    track('waitlist_joined', { country: iso })
    setWaitlistJoined(true)
    toast(`We'll notify you when ${dialCode || iso} numbers are back`, 'success')
  }

  const onContinue = async () => {
    if (!selected) return
    if (kycRequired) {
      setKycSheetOpen(true)
      return
    }
    await doRent()
  }

  const doRent = async () => {
    const pick = numbers.find((n) => n.number === selected)
    if (!pick || !country) return
    setRenting(true)
    try {
      const rented = await rentNumber(pick, iso, country.name)
      track('verify_started', { sid: rented.sid, country: iso })
      navigate(`/number/verify?sid=${encodeURIComponent(rented.sid)}`)
    } catch {
      toast("Couldn't rent this number — please try another", 'error')
    } finally {
      setRenting(false)
      setKycSheetOpen(false)
    }
  }

  return (
    <div className="flex min-h-dvh flex-col bg-[#0A0A0A]">
      <FlowHeader
        title={`Pick a ${country?.name ?? iso} number`}
        onBack={() => navigate(-1)}
      />

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 pt-4">
        <p className="mb-4 text-sm text-[#9A9A9E]">
          {monthlyUSD !== null && (
            <span className="font-semibold text-white">{formatUSD(monthlyUSD)}/mo</span>
          )}{' '}
          · monthly rental · voice & SMS included · cancel any time
        </p>

        {soldOut ? (
          <div className="flex flex-col items-center gap-4 rounded-[14px] bg-[#1C1C1E] p-8 text-center">
            <span className="text-4xl">{country?.flag ?? '🏳️'}</span>
            <p className="text-base font-semibold text-white">
              {country?.name ?? iso} numbers are sold out
            </p>
            <p className="text-sm text-[#9A9A9E]">
              New inventory is released regularly. Join the waitlist and we'll notify you
              the moment numbers are back.
            </p>
            <button
              onClick={joinWaitlist}
              disabled={waitlistJoined}
              className="flex min-h-[48px] items-center justify-center gap-2 rounded-2xl bg-[#D7FF3F] px-6 text-sm font-semibold text-black transition-opacity active:opacity-80 disabled:opacity-40"
            >
              <BellRing size={16} />
              {waitlistJoined
                ? 'You’re on the list'
                : `Notify me when ${dialCode || iso} numbers are back`}
            </button>
          </div>
        ) : (
          <>
            {failed && <ErrorState message="Inventory couldn't load." onRetry={() => loadPage(1)} />}
            {loading && numbers.length === 0 && <SkeletonRows count={5} />}

            {numbers.length > 0 && (
              <ul className="flex flex-col gap-2">
                {numbers.map((n) => (
                  <li key={n.number}>
                    <button
                      onClick={() => setSelected(n.number)}
                      aria-pressed={selected === n.number}
                      className={`flex min-h-[56px] w-full items-center gap-3 rounded-[14px] p-4 text-left transition-colors ${
                        selected === n.number
                          ? 'bg-[#1C1C1E] ring-2 ring-[#D7FF3F]'
                          : 'bg-[#1C1C1E] ring-1 ring-[#2C2C2E] active:bg-[#2C2C2E]'
                      }`}
                    >
                      <span className="flex-1 font-mono text-base text-white">{n.number}</span>
                      <span className="flex gap-1.5">
                        {n.voice && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-[#2C2C2E] px-2 py-0.5 text-[10px] font-semibold text-[#9A9A9E]">
                            <Phone size={10} /> Voice
                          </span>
                        )}
                        {n.sms && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-[#2C2C2E] px-2 py-0.5 text-[10px] font-semibold text-[#9A9A9E]">
                            <MessageSquare size={10} /> SMS
                          </span>
                        )}
                      </span>
                      <ChevronRight size={16} className="text-[#6E6E73]" />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {hasMore && !loading && (
              <button
                onClick={() => {
                  setPage((p) => p + 1)
                  void loadPage(page + 1)
                }}
                className="mt-3 min-h-[44px] rounded-2xl bg-[#2C2C2E] text-sm font-semibold text-white active:bg-[#3A3A3C]"
              >
                Show more numbers
              </button>
            )}
            {!loading && !failed && numbers.length === 0 && (
              <p className="py-10 text-center text-sm text-[#6E6E73]">
                No numbers available right now — join the waitlist below.
              </p>
            )}
            {!loading && !failed && numbers.length === 0 && (
              <button
                onClick={joinWaitlist}
                disabled={waitlistJoined}
                className="min-h-[48px] rounded-2xl bg-[#2C2C2E] text-sm font-semibold text-white disabled:opacity-40"
              >
                {waitlistJoined ? 'You’re on the list' : 'Join waitlist'}
              </button>
            )}
          </>
        )}
      </main>

      {/* KYC gate sheet */}
      {kycSheetOpen && (
        <div
          className="fixed inset-0 z-[60] flex items-end bg-black/60"
          onClick={() => setKycSheetOpen(false)}
        >
          <div
            className="w-full rounded-t-3xl bg-[#1C1C1E] p-5 pb-[max(1.5rem,env(safe-area-inset-bottom))]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-[#3A3A3C]" />
            <p className="flex items-center gap-2 text-base font-semibold text-white">
              <FileCheck2 size={18} className="text-[#D7FF3F]" /> ID verification required
            </p>
            <p className="mt-2 text-sm leading-relaxed text-[#9A9A9E]">
              {country?.name} requires identity verification before a number can be
              rented. You'll upload a photo ID after confirming — rental starts once the
              check passes (usually under 24h).
            </p>
            <button
              onClick={() => void doRent()}
              disabled={renting}
              className="mt-4 flex min-h-[52px] w-full items-center justify-center rounded-2xl bg-[#D7FF3F] text-sm font-semibold text-black transition-opacity active:opacity-80 disabled:opacity-40"
            >
              {renting ? 'Reserving…' : 'Continue to ID upload'}
            </button>
            <button
              onClick={() => setKycSheetOpen(false)}
              className="mt-2 min-h-[44px] w-full rounded-2xl bg-[#2C2C2E] text-sm font-semibold text-white"
            >
              Not now
            </button>
          </div>
        </div>
      )}

      {/* sticky CTA */}
      {!soldOut && (
        <div className="fixed inset-x-0 bottom-0 z-40 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
          <div className="mx-auto max-w-3xl">
            <button
              disabled={!selected || renting}
              onClick={() => void onContinue()}
              className="flex min-h-[56px] w-full items-center justify-center rounded-2xl bg-[#D7FF3F] text-base font-semibold text-black transition-opacity active:opacity-80 disabled:opacity-30"
            >
              {renting
                ? 'Reserving…'
                : selected
                  ? `Rent ${selected}`
                  : 'Select a number'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
