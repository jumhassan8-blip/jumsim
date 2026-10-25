import { useEffect, useRef, useState } from 'react'
import {
  Grid3x3,
  Mic,
  MicOff,
  PhoneOff,
  Volume2,
  VolumeX,
} from 'lucide-react'
import { CONFIG } from '../config'
import { formatUSD } from '../lib/money'
import { formatMinSec, type StartCallResult } from '../lib/calls'
import { flagFor } from '../lib/flags'

export interface CallSummary {
  durationSec: number
  costUSD: number
  balanceUSD: number
}

interface Props {
  session: StartCallResult
  countryName: string
  /** called once when the user hangs up (or credit runs out) — receives answered seconds */
  onFinished: (answeredSec: number) => void
  /** mid-call top-up: adds pack credit without dropping the call */
  onTopUp: (packUSD: number) => void
}

/** short two-tone warning beep at the 60-seconds-left mark (best effort) */
function warnTone(): void {
  try {
    const Ctx = window.AudioContext
    const ctx = new Ctx()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.frequency.value = 880
    gain.gain.setValueAtTime(0.08, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4)
    osc.connect(gain).connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + 0.45)
    osc.onended = () => void ctx.close()
  } catch {
    /* audio not available (headless/tests) — tone is best-effort */
  }
}

/**
 * Active call screen — in-call with live credit countdown, mute / speaker /
 * DTMF keypad, red hang-up, and the 60s-left top-up banner. Billing happens
 * server-side at hang-up (rate snapshot from call start); this screen never
 * decrements credit itself.
 */
export default function ActiveCall({ session, countryName, onFinished, onTopUp }: Props) {
  const [elapsed, setElapsed] = useState(0)
  const [muted, setMuted] = useState(false)
  const [speaker, setSpeaker] = useState(false)
  const [keypadOpen, setKeypadOpen] = useState(false)
  const [dtmf, setDtmf] = useState('')
  const [lowCredit, setLowCredit] = useState(false)

  const answeredAtRef = useRef<number | null>(null)
  const elapsedRef = useRef(0)
  const finishedRef = useRef(false)

  // The call is live by the time start returns (server-reported). The
  // ringing phase exists only for the brief pre-answer window.
  useEffect(() => {
    answeredAtRef.current = Date.now()
  }, [])

  // one-second ticker: elapsed time + live credit countdown + hard stop at 0
  useEffect(() => {
    const tick = window.setInterval(() => {
      if (answeredAtRef.current === null) return
      const s = Math.floor((Date.now() - answeredAtRef.current) / 1000)
      elapsedRef.current = s
      setElapsed(s)
      const remaining = session.balanceSeconds - s
      if (remaining <= CONFIG.calls.lowCreditSeconds && !lowCredit) {
        setLowCredit(true)
        warnTone()
      }
      if (remaining <= 0) finish()
    }, 1000)
    return () => window.clearInterval(tick)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.balanceSeconds, lowCredit])

  const finish = () => {
    if (finishedRef.current) return
    finishedRef.current = true
    onFinished(elapsedRef.current)
  }

  const remainingSec = Math.max(0, session.balanceSeconds - elapsed)
  const DTMF_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#']

  return (
    <div className="fixed inset-0 z-[80] flex flex-col bg-[#0A0A0A] px-6 pb-[max(2rem,env(safe-area-inset-bottom))] pt-16">
      {/* 60s-left banner: top up on the store (payment never happens in-app) */}
      {lowCredit && (
        <div className="mx-auto mb-4 w-full max-w-sm rounded-[14px] border border-[#FF9F0A]/40 bg-[#FF9F0A]/10 p-3 text-center">
          <p className="text-xs font-semibold text-[#FF9F0A]">Top up to keep talking</p>
          <p className="mt-0.5 text-[11px] text-[#9A9A9E]">
            Payment completes on jumesim.com — credit lands on your account.
          </p>
          <div className="mt-2 flex justify-center gap-2">
            {CONFIG.calls.packsUSD.map((usd) => (
              <button
                key={usd}
                onClick={() => {
                  onTopUp(usd)
                }}
                className="min-h-[40px] rounded-full bg-[#D7FF3F] px-4 text-xs font-bold text-black"
              >
                {formatUSD(usd)}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-1 flex-col items-center justify-center gap-6">
        <span className="text-5xl">{flagFor(session.iso2)}</span>
        <div className="text-center">
          <p className="text-xl font-semibold text-white">{session.to}</p>
          <p className="mt-1 text-sm text-[#9A9A9E]">{countryName}</p>
          <p className="mt-4 font-mono text-5xl font-semibold text-white" aria-label="Call duration">
            {formatMinSec(elapsed)}
          </p>
          <p className="mt-3 text-xs text-[#9A9A9E]" aria-label="Credit remaining">
            ⏱ {formatMinSec(remainingSec)} credit left ·{' '}
            {formatUSD(Math.round(elapsed * (session.ratePerMin / 60) * 100) / 100)} used
          </p>
        </div>

        {keypadOpen && (
          <div className="grid w-full max-w-[280px] grid-cols-3 gap-2" aria-label="DTMF keypad">
            {DTMF_KEYS.map((k) => (
              <button
                key={k}
                onClick={() => setDtmf((d) => (d + k).slice(-16))}
                className="flex h-14 items-center justify-center rounded-full bg-[#2C2C2E] text-xl font-semibold text-white active:bg-[#3A3A3C]"
              >
                {k}
              </button>
            ))}
          </div>
        )}
        {dtmf && <p className="font-mono text-sm text-[#9A9A9E]">{dtmf}</p>}
      </div>

      {/* controls */}
      <div className="mx-auto flex w-full max-w-sm items-center justify-between px-6">
        <button
          onClick={() => setMuted((v) => !v)}
          aria-pressed={muted}
          aria-label={muted ? 'Unmute' : 'Mute'}
          className={`flex h-14 w-14 items-center justify-center rounded-full ${
            muted ? 'bg-[#D7FF3F] text-black' : 'bg-[#2C2C2E] text-white'
          }`}
        >
          {muted ? <MicOff size={22} /> : <Mic size={22} />}
        </button>
        <button
          onClick={() => setSpeaker((v) => !v)}
          aria-pressed={speaker}
          aria-label={speaker ? 'Speaker off' : 'Speaker on'}
          className={`flex h-14 w-14 items-center justify-center rounded-full ${
            speaker ? 'bg-[#D7FF3F] text-black' : 'bg-[#2C2C2E] text-white'
          }`}
        >
          {speaker ? <Volume2 size={22} /> : <VolumeX size={22} />}
        </button>
        <button
          onClick={() => setKeypadOpen((v) => !v)}
          aria-pressed={keypadOpen}
          aria-label="Keypad"
          className={`flex h-14 w-14 items-center justify-center rounded-full ${
            keypadOpen ? 'bg-[#D7FF3F] text-black' : 'bg-[#2C2C2E] text-white'
          }`}
        >
          <Grid3x3 size={22} />
        </button>
      </div>

      <div className="mt-8 flex justify-center">
        <button
          onClick={finish}
          aria-label="Hang up"
          className="flex h-16 w-16 items-center justify-center rounded-full bg-[#FF453A] text-white active:opacity-80"
        >
          <PhoneOff size={28} />
        </button>
      </div>
    </div>
  )
}
