import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import {
  ChevronRight,
  Delete,
  Phone,
  PhoneCall,
  Timer,
  Trash2,
} from 'lucide-react'
import { parsePhoneNumberFromString } from 'libphonenumber-js'
import { CONFIG } from '../config'
import callRatesJson from '../data/call-rates.json'
import type { CallHistoryEntry, CallRate } from '../types'
import { formatUSD } from '../lib/money'
import { flagFor } from '../lib/flags'
import {
  addCallHistory,
  CALL_DEST_KEY,
  deleteCallHistory,
  endCall,
  formatMinSec,
  getCachedBalance,
  loadCallHistory,
  loadStoredDestination,
  publishBalance,
  refreshCallBalance,
  startCall,
  type StartCallResult,
} from '../lib/calls'
import { openStoreCredit } from '../lib/checkout-link'
import { track } from '../lib/analytics'
import { useStore } from '../state/StoreContext'
import CountryPicker from '../components/CountryPicker'
import BuyTimeSheet from '../components/BuyTimeSheet'
import ActiveCall, { type CallSummary } from '../components/ActiveCall'

const RATES = callRatesJson as CallRate[]
const rateByIso = new Map(RATES.map((r) => [r.iso2, r]))

/** longest dial codes first so "+1242" wins over "+1" while typing */
const BY_DIAL_PREFIX = [...RATES].sort(
  (a, b) => b.dialCode.replace('+', '').length - a.dialCode.replace('+', '').length,
)

function matchByDialPrefix(dialed: string): CallRate | null {
  const digits = dialed.replace(/^\+/, '').replace(/[^\d]/g, '')
  if (!digits) return null
  for (const r of BY_DIAL_PREFIX) {
    if (digits.startsWith(r.dialCode.replace('+', ''))) return r
  }
  return null
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#']

export default function Calls() {
  const navigate = useNavigate()
  const { toast, rentedNumber } = useStore()

  const [dest, setDest] = useState<CallRate>(() => loadStoredDestination())
  const [dialed, setDialed] = useState('')
  const [balanceUSD, setBalanceUSD] = useState<number | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [buySheetOpen, setBuySheetOpen] = useState(false)
  const [callerIdSheet, setCallerIdSheet] = useState(false)
  const [pendingDial, setPendingDial] = useState<string | null>(null)
  const [active, setActive] = useState<StartCallResult | null>(null)
  const [summary, setSummary] = useState<(CallSummary & { to: string; iso2: string }) | null>(null)
  const [history, setHistory] = useState<CallHistoryEntry[]>(() => loadCallHistory())
  const backspaceTimer = useRef<number | null>(null)

  const callerId = rentedNumber && rentedNumber.status === 'active' ? rentedNumber.number : null

  const secondsAtRate =
    balanceUSD !== null && dest.mobilePerMin > 0
      ? Math.floor((balanceUSD / dest.mobilePerMin) * 60)
      : null
  const minRequiredUSD = (dest.mobilePerMin / 60) * CONFIG.calls.minStartSeconds

  // publish to the tab-bar badge dot whenever balance or destination changes
  useEffect(() => {
    publishBalance({ balanceUSD, secondsAtRate })
  }, [balanceUSD, secondsAtRate])

  useEffect(() => {
    track('calls_tab_opened')
    let alive = true
    refreshCallBalance().then(() => {
      if (!alive) return
      const s = getCachedBalance()
      if (s.balanceUSD !== null) setBalanceUSD(s.balanceUSD)
    })
    return () => {
      alive = false
    }
  }, [])

  // auto-switch destination as the user types a dial prefix (+81 → Japan)
  useEffect(() => {
    if (!dialed.startsWith('+')) return
    const match = matchByDialPrefix(dialed)
    if (match && match.iso2 !== dest.iso2) setDest(match)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialed])

  const normalized = useMemo(() => {
    if (!dialed.trim()) return null
    try {
      const parsed = parsePhoneNumberFromString(dialed, dest.iso2 as never)
      return parsed && parsed.isValid() ? parsed : null
    } catch {
      return null
    }
  }, [dialed, dest.iso2])

  const isEmergency = useMemo(() => {
    const digits = dialed.replace(/\D/g, '')
    const national = normalized?.nationalNumber ?? digits
    return CONFIG.calls.emergencyNumbers.some(
      (e) => national === e || digits === e || dialed.replace(/^\+/, '').replace(/[\s()-]/g, '') === e,
    )
  }, [dialed, normalized])

  const pickDestination = (r: CallRate) => {
    setDest(r)
    try {
      localStorage.setItem(CALL_DEST_KEY, r.iso2)
    } catch {
      /* non-fatal */
    }
  }

  const pressKey = (k: string) => setDialed((d) => (d + k).slice(0, 24))
  const backspace = () => setDialed((d) => d.slice(0, -1))
  const startLongPress = () => {
    backspaceTimer.current = window.setTimeout(() => setDialed(''), 450)
  }
  const stopLongPress = () => {
    if (backspaceTimer.current) window.clearTimeout(backspaceTimer.current)
    backspaceTimer.current = null
  }
  // native dialer convention: long-press 0 inserts "+"
  const zeroTimer = useRef<number | null>(null)
  const zeroDown = () => {
    zeroTimer.current = window.setTimeout(() => {
      zeroTimer.current = null
      setDialed((d) => (d === '' ? '+' : d).slice(0, 24))
    }, 450)
  }
  const zeroUp = () => {
    if (zeroTimer.current) {
      window.clearTimeout(zeroTimer.current)
      zeroTimer.current = null
      pressKey('0')
    }
  }

  const refreshBalance = () => {
    void refreshCallBalance().then(() => {
      const s = getCachedBalance()
      if (s.balanceUSD !== null) setBalanceUSD(s.balanceUSD)
    })
  }

  const openBuySheet = () => {
    track('buy_time_sheet_viewed', { country: dest.country })
    track('call_blocked_insufficient', { country: dest.country, ratePerMin: dest.mobilePerMin })
    setBuySheetOpen(true)
  }

  const beginCall = async (e164: string) => {
    try {
      const session = await startCall(e164, dest.iso2)
      track('call_started', { country: dest.country, ratePerMin: session.ratePerMin })
      setSummary(null)
      setActive(session)
    } catch (err) {
      const e = err as Error & { status?: number; data?: { error?: string } }
      if (e?.status === 402) {
        setBalanceUSD((e.data as { balanceUSD?: number })?.balanceUSD ?? balanceUSD)
        openBuySheet()
      } else if (e?.data?.error === 'emergency_number') {
        toast('Emergency calls must use your regular SIM', 'error')
      } else if (e?.data?.error === 'call_in_progress') {
        toast('You already have a call in progress', 'error')
      } else if (e?.data?.error === 'calling_unavailable' || e?.status === 503) {
        // backend has no live calling provider configured — honest message,
        // never a fake call
        toast('Calling available after launch', 'info')
      } else {
        toast('Couldn’t start the call — check your connection', 'error')
      }
    }
  }

  const dial = () => {
    if (isEmergency) {
      toast('Emergency calls must use your regular SIM', 'error')
      return
    }
    if (!normalized) {
      toast('Enter a valid number — it is dialed as ' + dest.dialCode + ' …', 'error')
      return
    }
    if (balanceUSD !== null && balanceUSD < minRequiredUSD) {
      openBuySheet()
      return
    }
    if (!callerId) {
      setPendingDial(normalized.number)
      setCallerIdSheet(true)
      return
    }
    void beginCall(normalized.number)
  }

  const finishCall = (answeredSec: number) => {
    const session = active
    setActive(null)
    if (!session) return
    void endCall(session.sid, answeredSec).then((result) => {
      setBalanceUSD(result.balanceUSD)
      setSummary({
        to: session.to,
        iso2: session.iso2,
        durationSec: result.durationSec,
        costUSD: result.costUSD,
        balanceUSD: result.balanceUSD,
      })
      track('call_completed', { durationSec: result.durationSec, costUSD: result.costUSD })
      addCallHistory({
        id: `${Date.now()}_${session.sid}`,
        number: session.to,
        iso2: session.iso2,
        flag: flagFor(session.iso2),
        country: rateByIso.get(session.iso2)?.country ?? session.iso2,
        durationSec: result.durationSec,
        costUSD: result.costUSD,
        status: result.durationSec > 0 ? 'completed' : 'failed',
        at: Date.now(),
      })
      setHistory(loadCallHistory())
      refreshBalance()
    })
  }

  // Store compliance: mid-call top-up links out to jumesim.com — the app
  // never charges. The balance refreshes from the server on the next call.
  const topUpMidCall = (packUSD: number) => {
    track('topup_linkout_tapped', { packUSD, midCall: true })
    openStoreCredit()
    toast(`Complete the ${formatUSD(packUSD)} top-up on jumesim.com`, 'info')
  }

  const redial = (entry: CallHistoryEntry) => {
    pickDestination(rateByIso.get(entry.iso2) ?? dest)
    setDialed(entry.number)
  }

  const canCall =
    !isEmergency && normalized !== null && balanceUSD !== null && balanceUSD >= minRequiredUSD

  return (
    <div className="min-h-dvh bg-[#0A0A0A] pb-32">
      {/* header */}
      <header className="mx-auto flex w-full max-w-md items-center justify-between px-4 pt-6">
        <h1 className="text-2xl font-semibold text-white">Calls</h1>
        <button
          onClick={() => setBuySheetOpen(true)}
          aria-label="Buy call time"
          className="flex min-h-[40px] items-center gap-1.5 rounded-full bg-[#1C1C1E] px-4 text-sm font-semibold text-[#D7FF3F] ring-1 ring-[#2C2C2E] active:bg-[#2C2C2E]"
        >
          <Timer size={14} /> {secondsAtRate !== null ? `${formatMinSec(secondsAtRate)} left` : '…'}
        </button>
      </header>

      <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 pt-4">
        {/* destination bar */}
        <button
          onClick={() => setPickerOpen(true)}
          aria-label="Choose destination"
          className="flex min-h-[56px] w-full items-center gap-3 rounded-[14px] bg-[#1C1C1E] p-4 text-left ring-1 ring-[#2C2C2E] active:bg-[#2C2C2E]"
        >
          <span className="text-2xl">{flagFor(dest.iso2)}</span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-white">{dest.country}</span>
            <span className="block text-xs text-[#9A9A9E]">
              {dest.dialCode} · {formatUSD(dest.mobilePerMin)}/min
            </span>
          </span>
          <ChevronRight size={18} className="text-[#9A9A9E]" />
        </button>

        {/* dialer */}
        <div className="rounded-[14px] bg-[#1C1C1E] p-4">
          <div className="flex h-12 items-center justify-between gap-2 px-2">
            <p
              aria-label="Dialed number"
              className={`flex-1 truncate font-mono text-2xl tracking-wider ${
                dialed ? 'text-white' : 'text-[#6E6E73]'
              }`}
            >
              {dialed || dest.dialCode + ' …'}
            </p>
            {dialed && (
              <button
                onClick={backspace}
                onPointerDown={startLongPress}
                onPointerUp={stopLongPress}
                onPointerLeave={stopLongPress}
                aria-label="Delete digit (long-press to clear)"
                className="flex h-10 w-10 items-center justify-center rounded-full bg-[#2C2C2E] text-[#9A9A9E] active:bg-[#3A3A3C]"
              >
                <Delete size={16} />
              </button>
            )}
          </div>

          <div className="mt-2 grid grid-cols-3 gap-2" aria-label="Keypad">
            {KEYS.map((k) => (
              <button
                key={k}
                onClick={k === '0' ? undefined : () => pressKey(k)}
                onPointerDown={k === '0' ? zeroDown : undefined}
                onPointerUp={k === '0' ? zeroUp : undefined}
                onPointerLeave={k === '0' ? () => { if (zeroTimer.current) { window.clearTimeout(zeroTimer.current); zeroTimer.current = null } } : undefined}
                aria-label={k === '0' ? '0 (long-press for +)' : k}
                className="flex h-14 items-center justify-center rounded-2xl bg-[#2C2C2E] text-xl font-semibold text-white active:bg-[#3A3A3C]"
              >
                {k}
              </button>
            ))}
          </div>

          {/* call / buy-time CTA */}
          {isEmergency ? (
            <button
              disabled
              className="mt-3 flex min-h-[56px] w-full items-center justify-center gap-2 rounded-2xl bg-[#2C2C2E] text-base font-semibold text-[#6E6E73]"
            >
              <Phone size={20} /> Emergency? Use your regular SIM
            </button>
          ) : canCall ? (
            <button
              onClick={dial}
              className="mt-3 flex min-h-[56px] w-full items-center justify-center gap-2 rounded-2xl bg-[#D7FF3F] text-base font-bold text-black transition-opacity active:opacity-80"
            >
              <PhoneCall size={20} /> Call {dest.country}
            </button>
          ) : (
            <button
              onClick={normalized ? openBuySheet : undefined}
              disabled={!normalized}
              className="mt-3 flex min-h-[56px] w-full items-center justify-center gap-2 rounded-2xl bg-[#D7FF3F] text-base font-bold text-black transition-opacity active:opacity-80 disabled:bg-[#2C2C2E] disabled:text-[#6E6E73]"
            >
              <Timer size={20} />
              {normalized ? 'Buy time' : 'Enter a number to call'}
            </button>
          )}
          {normalized && balanceUSD !== null && balanceUSD < minRequiredUSD && (
            <p className="mt-2 text-center text-[11px] text-[#9A9A9E]">
              Needs {formatUSD(minRequiredUSD)} (60s at this rate) — you have{' '}
              {formatUSD(balanceUSD)}
            </p>
          )}
        </div>

        {/* local rates card */}
        <div className="rounded-[14px] bg-[#1C1C1E] p-4">
          <p className="mb-2 text-xs font-semibold text-[#9A9A9E]">Local Call Rates · {dest.country}</p>
          <div className="flex items-center justify-between text-sm">
            <span className="text-white">Mobile</span>
            <span className="font-semibold text-[#D7FF3F]">{formatUSD(dest.mobilePerMin)}/min</span>
          </div>
          <div className="mt-1.5 flex items-center justify-between text-sm">
            <span className="text-white">Landline</span>
            <span className="font-semibold text-[#D7FF3F]">
              {formatUSD(dest.landlinePerMin)}/min
            </span>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-[#6E6E73]">
            Billed by the second at the rate shown when the call connects. See Details: landlines
            bill at the landline rate; anything else bills at the mobile rate.
          </p>
        </div>

        {/* end-of-call summary */}
        {summary && (
          <div
            className="rounded-[14px] border border-[#D7FF3F]/40 bg-[#D7FF3F]/10 p-4"
            role="status"
          >
            <p className="text-center text-sm font-semibold text-white">
              {formatMinSec(summary.durationSec)} · {formatUSD(summary.costUSD)} used ·{' '}
              {formatMinSec(
                summary.balanceUSD / ((rateByIso.get(summary.iso2)?.mobilePerMin ?? 0.1) / 60),
              )}{' '}
              remaining
            </p>
          </div>
        )}

        {/* history */}
        <div>
          <p className="mb-2 text-xs font-semibold text-[#9A9A9E]">Recent calls</p>
          {history.length === 0 ? (
            <p className="rounded-[14px] bg-[#1C1C1E] p-4 text-sm text-[#6E6E73]">
              No calls yet — dial a number above.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {history.map((entry) => (
                <li
                  key={entry.id}
                  className="flex items-center gap-3 rounded-[14px] bg-[#1C1C1E] p-3"
                >
                  <button
                    onClick={() => redial(entry)}
                    aria-label={`Redial ${entry.number}`}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  >
                    <span className="text-xl">{entry.flag}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-mono text-sm text-white">
                        {entry.number}
                      </span>
                      <span className="block text-xs text-[#9A9A9E]">
                        {entry.country} ·{' '}
                        {entry.status === 'failed' ? (
                          <span className="text-[#FF9F0A]">No charge</span>
                        ) : (
                          <>
                            {formatMinSec(entry.durationSec)} · {formatUSD(entry.costUSD)}
                          </>
                        )}{' '}
                        · {new Date(entry.at).toLocaleDateString()}
                      </span>
                    </span>
                    <PhoneCall size={16} className="shrink-0 text-[#9A9A9E]" />
                  </button>
                  <button
                    onClick={() => {
                      deleteCallHistory(entry.id)
                      setHistory(loadCallHistory())
                    }}
                    aria-label={`Delete call ${entry.number}`}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#2C2C2E] text-[#9A9A9E] active:bg-[#3A3A3C]"
                  >
                    <Trash2 size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>

      {/* country picker */}
      {pickerOpen && (
        <CountryPicker
          rates={RATES}
          selectedIso2={dest.iso2}
          onPick={pickDestination}
          onClose={() => setPickerOpen(false)}
        />
      )}

      {/* buy-time sheet */}
      {buySheetOpen && (
        <BuyTimeSheet
          ratePerMin={dest.mobilePerMin}
          countryName={dest.country}
          onCredited={(b) => {
            setBalanceUSD(b)
            refreshBalance()
          }}
          onClose={() => setBuySheetOpen(false)}
        />
      )}

      {/* caller-ID upsell (Path A plumbing) */}
      {callerIdSheet && (
        <div
          className="fixed inset-0 z-[70] flex items-end bg-black/60"
          onClick={() => setCallerIdSheet(false)}
          role="dialog"
          aria-label="Caller ID"
        >
          <div
            className="w-full rounded-t-3xl bg-[#1C1C1E] p-5 pb-[max(1.5rem,env(safe-area-inset-bottom))]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-[#3A3A3C]" />
            <p className="text-base font-semibold text-white">Get a number so people see who’s calling</p>
            <p className="mt-2 text-sm leading-relaxed text-[#9A9A9E]">
              Rent a number once — it becomes your caller ID on every call and stays yours month
              to month.
            </p>
            <button
              onClick={() => {
                setCallerIdSheet(false)
                navigate('/number/country')
              }}
              className="mt-4 flex min-h-[52px] w-full items-center justify-center rounded-2xl bg-[#D7FF3F] text-sm font-bold text-black"
            >
              Choose your number
            </button>
            <button
              onClick={() => {
                setCallerIdSheet(false)
                if (pendingDial) void beginCall(pendingDial)
                setPendingDial(null)
              }}
              className="mt-2 min-h-[48px] w-full rounded-2xl bg-[#2C2C2E] text-sm font-semibold text-white"
            >
              Continue anyway — calls show as Unknown
            </button>
          </div>
        </div>
      )}

      {/* active call overlay */}
      {active && (
        <ActiveCall
          session={active}
          countryName={rateByIso.get(active.iso2)?.country ?? active.iso2}
          onFinished={finishCall}
          onTopUp={topUpMidCall}
        />
      )}
    </div>
  )
}
