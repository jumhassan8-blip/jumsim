import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { PhoneCall, PhoneOff, ShieldAlert, Wallet as WalletIcon } from 'lucide-react'
import { loadPricing } from '../data/pricing'
import { useStore } from '../state/StoreContext'
import { formatUSD } from '../lib/money'
import { PACKS } from '../lib/wallet'
import { checkoutConfigured } from '../lib/checkout-link'
import { FlowHeader, SkeletonRows, ErrorState } from '../components/ui-bits'
import { parsePhoneNumberFromString } from 'libphonenumber-js'
import { track } from '../lib/analytics'

type Phase = 'idle' | 'calling'

export default function Call() {
  const { slug = '' } = useParams()
  const navigate = useNavigate()
  const { countryBySlug, wallet, buyCreditPack, settleCall, toast, rentedNumber } =
    useStore()
  const country = countryBySlug(slug)

  const [rates, setRates] = useState<{ mobile: number; landline: number } | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [number, setNumber] = useState('')
  const [phase, setPhase] = useState<Phase>('idle')
  const [seconds, setSeconds] = useState(0)
  const [lowBalanceShown, setLowBalanceShown] = useState(false)
  const [topUpSheet, setTopUpSheet] = useState(false)
  const [dialed, setDialed] = useState('')
  const startRef = useRef(0)
  const tickRef = useRef<number | null>(null)

  const rate = rates?.mobile ?? 0.08
  const perSecond = rate / 60

  useEffect(() => {
    let alive = true
    loadPricing()
      .then((p) => {
        if (!alive || !country) return
        const e = p.countries[country.iso2]
        setRates(e ? e.callRates : p.callRatesDefault)
      })
      .catch(() => alive && setLoadFailed(true))
    return () => {
      alive = false
    }
  }, [country])

  useEffect(
    () => () => {
      if (tickRef.current) window.clearInterval(tickRef.current)
    },
    [],
  )

  const estSecondsLeft = useMemo(
    () => (perSecond > 0 ? Math.floor(wallet.balance / perSecond) : 0),
    [wallet.balance, perSecond],
  )

  const callerId =
    rentedNumber && rentedNumber.status === 'active' ? rentedNumber.number : null

  /** normalize user input to E.164, falling back to the destination country dial code */
  const normalizeE164 = (raw: string): string | null => {
    const cc = country?.iso2 && country.iso2.length === 2 ? country.iso2 : undefined
    const parsed = parsePhoneNumberFromString(raw, cc as never)
    if (parsed && parsed.isValid()) return parsed.number
    return null
  }

  const startCall = () => {
    if (!callerId) return
    // MIN 60-SECOND RULE: block the call if balance < 60s of destination rate
    if (wallet.balance < perSecond * 60) {
      setTopUpSheet(true)
      return
    }
    const e164 = normalizeE164(number)
    if (!e164) {
      toast('Enter a valid number in international format, e.g. +49 151 2345678', 'error')
      return
    }
    // Path 2 (honest): data-only eSIM → in-app VoIP. Balance checked before connect.
    track('call_outgoing', { to: e164, callerId, rate })
    setDialed(e164)
    setPhase('calling')
    setSeconds(0)
    setLowBalanceShown(false)
    startRef.current = Date.now()
    tickRef.current = window.setInterval(() => {
      const s = Math.floor((Date.now() - startRef.current) / 1000)
      setSeconds(s)
      // LOW-BALANCE RULE: warn once at ~2 minutes of remaining credit
      const remainingSec = estSecondsLeft - s
      if (!lowBalanceShown && remainingSec <= 120 && remainingSec > 0) {
        setLowBalanceShown(true)
      }
      if (remainingSec <= 0) {
        endCall()
        toast('Call ended — call credit ran out', 'error')
      }
    }, 1000)
  }

  const endCall = () => {
    if (tickRef.current) window.clearInterval(tickRef.current)
    tickRef.current = null
    const s = Math.floor((Date.now() - startRef.current) / 1000)
    if (s > 0) {
      const cost = Math.round(s * perSecond * 100) / 100
      const paidInFull = settleCall(cost, `Call to ${number} · ${country?.name ?? ''}`)
      if (!paidInFull) toast('Partially covered — credit ran out mid-call', 'info')
    }
    setPhase('idle')
    setSeconds(0)
  }

  const mm = String(Math.floor(seconds / 60)).padStart(2, '0')
  const ss = String(seconds % 60).padStart(2, '0')

  return (
    <div className="flex min-h-dvh flex-col bg-[#0A0A0A]">
      <FlowHeader title={`Call · ${country?.name ?? ''}`} onBack={() => navigate(-1)} />

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 pt-6">
        {loadFailed && (
          <ErrorState message="Rates couldn't be loaded." onRetry={() => navigate(0)} />
        )}
        {!rates && !loadFailed && <SkeletonRows count={2} />}

        {rates && phase === 'idle' && !callerId && (
          <div className="flex flex-col items-center gap-4 rounded-[14px] bg-[#1C1C1E] p-8 text-center">
            <p className="text-base font-semibold text-white">Rent a number to place calls</p>
            <p className="text-sm leading-relaxed text-[#9A9A9E]">
              Your calls show a local caller ID. Rent a number once — it stays yours
              month to month and works for calls to any country.
            </p>
            <button
              onClick={() => navigate('/number/country')}
              className="flex min-h-[48px] items-center justify-center rounded-2xl bg-[#D7FF3F] px-6 text-sm font-semibold text-black"
            >
              Choose your number
            </button>
          </div>
        )}

        {rates && phase === 'idle' && callerId && (
          <div className="flex flex-col gap-4">
            <p className="text-center text-xs text-[#6E6E73]">
              Calls placed in-app over your Jum data (VoIP) · {formatUSD(rate)}/min to
              mobiles
            </p>
            <p className="text-center text-xs font-semibold text-[#D7FF3F]">
              Caller ID {callerId}
            </p>
            <div className="rounded-[14px] bg-[#1C1C1E] p-4">
              <input
                value={number}
                onChange={(e) => setNumber(e.target.value.replace(/[^\d+\s-]/g, ''))}
                inputMode="tel"
                placeholder="+49 151 2345678"
                aria-label="Phone number"
                className="h-14 w-full rounded-xl bg-[#2C2C2E] px-4 text-center text-xl tracking-wider text-white placeholder-[#6E6E73] outline-none ring-1 ring-[#3A3A3C] focus:ring-2 focus:ring-[#D7FF3F]"
              />
              <div className="mt-3 flex items-center justify-between text-xs text-[#9A9A9E]">
                <span className="inline-flex items-center gap-1.5">
                  <WalletIcon size={12} className="text-[#D7FF3F]" />
                  Balance {formatUSD(wallet.balance)}
                </span>
                <span>~{Math.floor(estSecondsLeft / 60)} min available</span>
              </div>
            </div>
            <button
              onClick={startCall}
              className="flex min-h-[56px] w-full items-center justify-center gap-2 rounded-2xl bg-[#D7FF3F] text-base font-semibold text-black transition-opacity active:opacity-80"
            >
              <PhoneCall size={20} /> Call via Jum app
            </button>
            <p className="text-center text-[11px] text-[#6E6E73]">
              Calls need at least 60 seconds of credit at this rate before connecting
            </p>
          </div>
        )}

        {phase === 'calling' && (
          <div className="flex flex-1 flex-col items-center justify-center gap-6 py-10">
            <span className="text-4xl">{country?.flag}</span>
            <div className="text-center">
              <p className="text-xl font-semibold text-white">{dialed || 'Connecting…'}</p>
              <p className="mt-2 font-mono text-5xl font-semibold text-[#D7FF3F]">
                {mm}:{ss}
              </p>
              <p className="mt-2 text-xs text-[#9A9A9E]">
                {formatUSD(Math.round(seconds * perSecond * 100) / 100)} used · balance{' '}
                {formatUSD(wallet.balance)}
              </p>
            </div>

            {/* LOW-BALANCE RULE: offer top-up mid-call-sheet */}
            {lowBalanceShown && (
              <div className="w-full max-w-sm rounded-[14px] border border-[#FF453A]/40 bg-[#FF453A]/10 p-4 text-center">
                <p className="text-sm font-semibold text-[#FF6961]">
                  Under 2 minutes of credit left
                </p>
                <p className="mt-1 text-xs text-[#9A9A9E]">
                  Top up now to keep talking — payment completes on jumesim.com
                </p>
                <div className="mt-3 flex justify-center gap-2">
                  <button
                    onClick={() => {
                      if (!checkoutConfigured) return
                      buyCreditPack(PACKS[0])
                      setLowBalanceShown(false)
                    }}
                    disabled={!checkoutConfigured}
                    className="min-h-[44px] rounded-full bg-[#D7FF3F] px-4 text-xs font-bold text-black disabled:opacity-50"
                  >
                    {checkoutConfigured ? 'Top up on jumesim.com' : 'Store opening soon'}
                  </button>
                </div>
              </div>
            )}

            <button
              onClick={endCall}
              className="flex h-16 w-16 items-center justify-center rounded-full bg-[#FF453A] text-white active:opacity-80"
              aria-label="End call"
            >
              <PhoneOff size={26} />
            </button>
          </div>
        )}
      </main>
      {/* MIN 60-SECOND RULE — inline top-up sheet */}
      {topUpSheet && (
        <div
          className="fixed inset-0 z-[60] flex items-end bg-black/60"
          onClick={() => setTopUpSheet(false)}
        >
          <div
            className="w-full rounded-t-3xl bg-[#1C1C1E] p-5 pb-[max(1.5rem,env(safe-area-inset-bottom))]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-[#3A3A3C]" />
            <p className="flex items-center gap-2 text-base font-semibold text-white">
              <ShieldAlert size={18} className="text-[#FF9F0A]" /> Not enough credit to start
            </p>
            <p className="mt-2 text-sm text-[#9A9A9E]">
              This call needs {formatUSD(perSecond * 60)} (60 seconds at {formatUSD(rate)}
              /min). Top up to connect.
            </p>
            <button
              onClick={() => {
                if (!checkoutConfigured) return
                buyCreditPack(PACKS[0])
                setTopUpSheet(false)
              }}
              disabled={!checkoutConfigured}
              className="mt-4 min-h-[52px] w-full rounded-xl bg-[#D7FF3F] text-sm font-bold text-black active:opacity-80 disabled:opacity-50"
            >
              {checkoutConfigured ? 'Top up on jumesim.com' : 'Store opening soon'}
            </button>
            <p className="mt-2 text-center text-[10px] text-[#6E6E73]">
              Payment completes securely on jumesim.com — credit appears in the app.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
