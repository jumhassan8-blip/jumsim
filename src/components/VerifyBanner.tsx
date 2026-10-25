/**
 * Email-verification banner — shown after sign-up until the user verifies
 * (or dismisses with "I'll verify later", which is remembered per account).
 *
 * Part 2 spec: "We sent a verification link to {email} — check your inbox
 * (and spam). [Resend] [I'll verify later]". Resend is throttled: 60-second
 * cooldown, max 3 sends/hour (enforced in AuthContext).
 */
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MailCheck, X } from 'lucide-react'
import { useAuth } from '../state/AuthContext'

const DISMISS_KEY = 'jum-esim:verify-dismissed:v1'

function dismissedUids(): string[] {
  try {
    const raw = localStorage.getItem(DISMISS_KEY)
    return raw ? (JSON.parse(raw) as string[]) : []
  } catch {
    return []
  }
}

export default function VerifyBanner() {
  const { t } = useTranslation()
  const { session, needsVerification, busy, verifyCooldownUntil, resendVerification, refreshVerification, verifySendError } = useAuth()
  const account = session.account
  const [dismissed, setDismissed] = useState(false)
  const [resent, setResent] = useState(false)
  const [cooldownLeft, setCooldownLeft] = useState(0)

  useEffect(() => {
    if (account && dismissedUids().includes(account.uid)) setDismissed(true)
  }, [account])

  // poll the server occasionally — the user may have clicked the link
  useEffect(() => {
    if (!needsVerification) return
    const t1 = window.setTimeout(() => void refreshVerification(), 5000)
    const t2 = window.setInterval(() => void refreshVerification(), 60_000)
    return () => {
      window.clearTimeout(t1)
      window.clearInterval(t2)
    }
  }, [needsVerification, refreshVerification])

  // resend cooldown countdown
  useEffect(() => {
    if (!verifyCooldownUntil) {
      setCooldownLeft(0)
      return
    }
    const tick = () => setCooldownLeft(Math.max(0, Math.ceil((verifyCooldownUntil - Date.now()) / 1000)))
    tick()
    const id = window.setInterval(tick, 1000)
    return () => window.clearInterval(id)
  }, [verifyCooldownUntil])

  if (!account || dismissed) return null

  // Verified: brief green confirmation where the amber banner was — auto-dismisses
  if (!needsVerification) {
    return (
      <div className="mb-4 flex items-center gap-3 rounded-[14px] border border-[#32D74B]/40 bg-[#32D74B]/10 p-4">
        <MailCheck size={18} className="shrink-0 text-[#32D74B]" />
        <p className="text-sm font-semibold text-[#32D74B]">{t('verify.verifiedState')}</p>
      </div>
    )
  }

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, JSON.stringify([...dismissedUids(), account.uid]))
    } catch {
      /* non-fatal */
    }
    setDismissed(true)
  }

  const resend = async () => {
    setResent(false)
    const status = await resendVerification()
    if (status === 'sent') setResent(true)
  }

  return (
    <div className="mb-4 rounded-[14px] border border-[#FF9F0A]/40 bg-[#FF9F0A]/10 p-4">
      <div className="flex items-start gap-3">
        <MailCheck size={18} className="mt-0.5 shrink-0 text-[#FF9F0A]" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-white">{t('verify.bannerTitle')}</p>
          <p className="mt-1 text-xs leading-relaxed text-[#9A9A9E]">
            {t('verify.bannerBody', { email: account.email ?? '' })}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              onClick={() => void resend()}
              disabled={busy || cooldownLeft > 0}
              className="min-h-[40px] rounded-xl bg-[#D7FF3F] px-4 text-xs font-bold text-black disabled:opacity-40"
            >
              {cooldownLeft > 0
                ? t('verify.resendCooldown', { seconds: cooldownLeft })
                : t('verify.resend')}
            </button>
            <button
              onClick={dismiss}
              className="min-h-[40px] rounded-xl bg-[#2C2C2E] px-4 text-xs font-semibold text-[#9A9A9E]"
            >
              {t('verify.later')}
            </button>
            {resent && !verifySendError && (
              <span className="text-xs font-semibold text-[#32D74B]">{t('verify.resent')}</span>
            )}
          </div>
          {verifySendError && (
            // Post-signup send failure = resend state, NOT an error banner:
            // the account exists (signup succeeded); the user just needs a
            // working Resend button.
            <div className="mt-3 rounded-xl border border-[#32D74B]/40 bg-[#32D74B]/10 p-3">
              <p className="text-sm font-semibold text-[#32D74B]">{t('verify.accountCreated')}</p>
              <p className="mt-1 break-all text-xs leading-relaxed text-[#9A9A9E]">
                {t('verify.sendFailedResend', { code: verifySendError.code, message: verifySendError.message })}
              </p>
            </div>
          )}
        </div>
        <button onClick={dismiss} aria-label={t('auth.back')} className="text-[#6E6E73]">
          <X size={16} />
        </button>
      </div>
    </div>
  )
}
