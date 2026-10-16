import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { MessageSquareText, ShieldAlert } from 'lucide-react'
import { numberProvider } from '../providers/number'
import { useStore } from '../state/StoreContext'
import { track } from '../lib/analytics'
import { FlowHeader } from '../components/ui-bits'

const RESEND_SEC = 60
const MAX_ATTEMPTS = 3
const COOLDOWN_SEC = 300

export default function VerifyNumber() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const sid = params.get('sid') ?? ''
  const { rentedNumber, verifyRentedNumber, toast } = useStore()

  const [digits, setDigits] = useState<string[]>(Array(6).fill(''))
  const [attempts, setAttempts] = useState(0)
  const [resendIn, setResendIn] = useState(0)
  const [cooldownIn, setCooldownIn] = useState(0)
  const [busy, setBusy] = useState(false)
  const inputsRef = useRef<Array<HTMLInputElement | null>>([])

  const number = rentedNumber?.number ?? ''

  useEffect(() => {
    const t = window.setInterval(() => {
      setResendIn((s) => Math.max(0, s - 1))
      setCooldownIn((s) => {
        const n = Math.max(0, s - 1)
        if (n === 0) setAttempts(0)
        return n
      })
    }, 1000)
    return () => window.clearInterval(t)
  }, [])

  const code = useMemo(() => digits.join(''), [digits])
  const complete = code.length === 6 && digits.every((d) => d !== '')

  const resend = async () => {
    await numberProvider.requestVerificationCode(sid)
    setResendIn(RESEND_SEC)
    toast('New code sent', 'success')
  }

  const submit = async () => {
    if (!complete || busy) return
    setBusy(true)
    try {
      const ok = await verifyRentedNumber(sid, code)
      if (ok) {
        track('verify_completed', { sid })
        toast('Number activated', 'success')
        navigate('/profile')
      } else {
        const next = attempts + 1
        setAttempts(next)
        setDigits(Array(6).fill(''))
        inputsRef.current[0]?.focus()
        if (next >= MAX_ATTEMPTS) {
          setCooldownIn(COOLDOWN_SEC)
          toast('Too many attempts — try again in 5 minutes', 'error')
        } else {
          toast(`Wrong code — ${MAX_ATTEMPTS - next} attempt${MAX_ATTEMPTS - next > 1 ? 's' : ''} left`, 'error')
        }
      }
    } finally {
      setBusy(false)
    }
  }

  const setDigit = (i: number, v: string) => {
    const c = v.replace(/\D/g, '').slice(-1)
    setDigits((prev) => {
      const next = [...prev]
      next[i] = c
      return next
    })
    if (c && i < 5) inputsRef.current[i + 1]?.focus()
  }

  const onKeyDown = (i: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !digits[i] && i > 0) inputsRef.current[i - 1]?.focus()
  }

  return (
    <div className="flex min-h-dvh flex-col bg-[#0A0A0A]">
      <FlowHeader title="Verify your number" onBack={() => navigate(-1)} />

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center px-4 pt-10">
        <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#1C1C1E]">
          <MessageSquareText size={24} className="text-[#D7FF3F]" />
        </span>
        <p className="text-center text-base font-semibold text-white">
          We sent a code to {number || 'your number'}
        </p>
        <p className="mt-1 text-center text-sm text-[#9A9A9E]">
          Enter the 6-digit code to activate your rental
        </p>

        <div className="mt-6 flex gap-2">
          {digits.map((d, i) => (
            <input
              key={i}
              ref={(el) => {
                inputsRef.current[i] = el
              }}
              value={d}
              onChange={(e) => setDigit(i, e.target.value)}
              onKeyDown={(e) => onKeyDown(i, e)}
              onPaste={(e) => {
                const text = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6)
                if (text.length >= 2) {
                  e.preventDefault()
                  setDigits(Array.from({ length: 6 }, (_, j) => text[j] ?? ''))
                  inputsRef.current[Math.min(text.length, 5)]?.focus()
                }
              }}
              inputMode="numeric"
              aria-label={`Digit ${i + 1}`}
              className="h-14 w-11 rounded-xl bg-[#1C1C1E] text-center text-xl font-semibold text-white outline-none ring-1 ring-[#3A3A3C] focus:ring-2 focus:ring-[#D7FF3F]"
            />
          ))}
        </div>

        {cooldownIn > 0 ? (
          <p className="mt-4 flex items-center gap-1.5 text-xs text-[#FF6961]">
            <ShieldAlert size={12} /> Too many attempts — retry in {Math.ceil(cooldownIn / 60)}:
            {String(cooldownIn % 60).padStart(2, '0')}
          </p>
        ) : (
          <button
            onClick={() => void resend()}
            disabled={resendIn > 0}
            className="mt-4 text-xs font-semibold text-[#D7FF3F] disabled:text-[#6E6E73]"
          >
            {resendIn > 0 ? `Resend code in ${resendIn}s` : 'Resend code'}
          </button>
        )}

        <button
          onClick={() => void submit()}
          disabled={!complete || busy || cooldownIn > 0}
          className="mt-6 flex min-h-[56px] w-full max-w-sm items-center justify-center rounded-2xl bg-[#D7FF3F] text-base font-semibold text-black transition-opacity active:opacity-80 disabled:opacity-30"
        >
          {busy ? 'Verifying…' : 'Activate number'}
        </button>
      </main>
    </div>
  )
}
