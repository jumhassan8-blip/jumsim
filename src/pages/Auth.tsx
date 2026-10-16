/**
 * Auth screen — sign up / log in / forgot password.
 *
 * Guest mode stays: this screen is an offer, never a wall. The whole app
 * works without an account (purchases live on the device + the anonymous
 * session); signing in only adds cross-device sync.
 *
 * Behaviors (Module 16 spec):
 *  - sign-up: strength meter, verify-password, terms checkbox, inline errors
 *  - "Email already in use" → offers login; "Wrong password" → reset link
 *  - forgot password: sends the reset email, shows in-app confirmation
 *  - restore purchases (login screen): email-match re-association + cloud pull
 *  - social buttons only behind config.auth.socialEnabled (phase 2, off)
 */
import { useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, Mail, ShieldCheck } from 'lucide-react'
import PasswordToggle from '../components/PasswordToggle'
import { useAuth } from '../state/AuthContext'
import { authConfig } from '../../config/firebase'
import { track } from '../lib/analytics'

type Mode = 'login' | 'signup' | 'forgot'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** 0–4 strength score: length + character variety. */
function passwordStrength(pw: string): number {
  if (!pw) return 0
  let score = 0
  if (pw.length >= 8) score++
  if (pw.length >= 12) score++
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++
  if (/\d/.test(pw)) score++
  if (/[^a-zA-Z0-9]/.test(pw)) score++
  return Math.min(4, score)
}

const strengthColors = ['#FF453A', '#FF9F0A', '#FFD60A', '#32D74B']
const strengthKeys = ['auth.strengthWeak', 'auth.strengthFair', 'auth.strengthGood', 'auth.strengthStrong']

export default function Auth() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { session, busy, error, clearError, signUp, signIn, resetPassword, restorePurchases, debugAuthError } = useAuth()

  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [confirm, setConfirm] = useState('')
  const [showConfirm, setShowConfirm] = useState(false)
  const [terms, setTerms] = useState(false)
  const [touched, setTouched] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [restoreMsg, setRestoreMsg] = useState<string | null>(null)
  const startedRef = useRef(false)

  if (session.ready && session.account && !session.account.isAnonymous) {
    // already signed in — the profile card is the account surface
    navigate('/profile', { replace: true })
    return null
  }

  const switchMode = (m: Mode) => {
    setMode(m)
    setFieldErrors({})
    clearError()
    setRestoreMsg(null)
    if (m === 'signup' && !startedRef.current) {
      // started = the signup form was entered with intent
      track('auth_signup_started', {})
      startedRef.current = true
    }
  }

  const validate = (): boolean => {
    const errs: Record<string, string> = {}
    if (!EMAIL_RE.test(email)) errs.email = t('auth.emailInvalid')
    if (mode === 'signup') {
      if (password.length < 8) errs.password = t('auth.passwordShort')
      else if (passwordStrength(password) < 2) errs.password = t('auth.passwordWeak')
      if (confirm !== password) errs.confirm = t('auth.passwordMismatch')
      if (!terms) errs.terms = t('auth.termsRequired')
    } else if (mode === 'login' && !password) {
      errs.password = t('auth.passwordRequired')
    }
    setFieldErrors(errs)
    return Object.keys(errs).length === 0
  }

  const submit = async () => {
    setTouched(true)
    setRestoreMsg(null)
    if (!validate()) return
    if (mode === 'login') {
      const ok = await signIn(email, password)
      if (ok) navigate('/profile', { replace: true })
    } else if (mode === 'signup') {
      track('auth_signup_started', {})
      const ok = await signUp(email, password)
      if (ok) navigate('/profile', { replace: true })
    } else {
      await resetPassword(email)
      setSentTo(email)
    }
  }

  const onRestore = async () => {
    setRestoreMsg(null)
    const count = await restorePurchases()
    setRestoreMsg(count > 0 ? t('auth.restoreDone', { count }) : t('auth.restoreNone'))
  }

  const strength = passwordStrength(password)
  const errKey =
    error === 'email-in-use'
      ? 'auth.errorEmailInUse'
      : error === 'wrong-password'
        ? 'auth.errorWrongPassword'
        : error === 'user-not-found'
          ? 'auth.errorUserNotFound'
          : error === 'network'
            ? 'auth.errorNetwork'
            : error === 'network-timeout'
              ? 'auth.errorNetworkTimeout'
              : error === 'unauthorized-domain'
                ? 'auth.errorUnauthorizedDomain'
                : error === 'config-error'
                  ? 'auth.errorConfigError'
                  : error
                    ? 'auth.errorGeneric'
                    : null

  const inputCls =
    'min-h-[48px] w-full rounded-xl border border-[#3A3A3C] bg-[#1C1C1E] px-4 text-sm text-white placeholder-[#6E6E73] outline-none focus:border-[#D7FF3F]/60'
  const errCls = 'mt-1 text-xs text-[#FF6961]'
  const labelCls = 'mb-2 block text-sm font-semibold text-[#9A9A9E]'

  return (
    <div className="mx-auto min-h-dvh max-w-md bg-[#0A0A0A] px-5 pb-16 pt-4">
      <button
        onClick={() => navigate(-1)}
        aria-label={t('auth.back')}
        className="mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-[#1C1C1E] text-white"
      >
        <ChevronLeft size={20} className="flip-rtl" />
      </button>

      <h1 className="text-2xl font-semibold tracking-tight text-white">
        {mode === 'signup' ? t('auth.titleSignUp') : mode === 'forgot' ? t('auth.forgotTitle') : t('auth.titleSignIn')}
      </h1>
      <p className="mt-2 flex items-start gap-2 text-sm leading-relaxed text-[#9A9A9E]">
        <ShieldCheck size={16} className="mt-0.5 shrink-0 text-[#D7FF3F]" />
        {mode === 'forgot' ? t('auth.forgotBody') : t('auth.subtitle')}
      </p>

      {mode === 'forgot' && sentTo ? (
        <div className="mt-8">
          <div className="rounded-2xl border border-[#D7FF3F]/30 bg-[#D7FF3F]/5 p-5">
            <p className="flex items-center gap-2 text-sm font-semibold text-white">
              <Mail size={16} className="text-[#D7FF3F]" /> {t('auth.forgotSentTitle')}
            </p>
            <p className="mt-2 text-sm leading-relaxed text-[#9A9A9E]">
              {t('auth.forgotSentBody', { email: sentTo })}
            </p>
          </div>

          <button
            onClick={() => {
              setSentTo(null)
              switchMode('login')
            }}
            className="mt-6 flex min-h-[48px] w-full items-center justify-center rounded-2xl bg-[#D7FF3F] text-sm font-semibold text-black"
          >
            {t('auth.forgotBack')}
          </button>
        </div>
      ) : (
        <div className="mt-8 flex flex-col gap-4">
          <div>
            <label htmlFor="auth-email" className={labelCls}>{t('auth.emailLabel')}</label>
            <input
              id="auth-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t('auth.emailPlaceholder')}
              className={inputCls}
            />
            {touched && fieldErrors.email && <p className={errCls}>{fieldErrors.email}</p>}
          </div>

          {mode !== 'forgot' && (
            <div>
              <label htmlFor="auth-password" className={labelCls}>{t('auth.passwordLabel')}</label>
              <div className="relative">
                <input
                  id="auth-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t('auth.passwordPlaceholder')}
                  className={`${inputCls} pr-12`}
                />
                <PasswordToggle id="auth-password" visible={showPassword} onToggle={setShowPassword} />
              </div>
              {touched && fieldErrors.password && <p className={errCls}>{fieldErrors.password}</p>}
              {/* strength meter — sign-up only */}
              {mode === 'signup' && password.length > 0 && (
                <div className="mt-2">
                  <div className="flex gap-1">
                    {[0, 1, 2, 3].map((i) => (
                      <div
                        key={i}
                        className="h-1 flex-1 rounded-full transition-colors"
                        style={{ backgroundColor: i < strength ? strengthColors[strength - 1] : '#3A3A3C' }}
                      />
                    ))}
                  </div>
                  <p className="mt-1 text-[11px] font-semibold" style={{ color: strengthColors[strength - 1] }}>
                    {t(strengthKeys[Math.max(0, strength - 1)])}
                  </p>
                </div>
              )}
            </div>
          )}

          {mode === 'signup' && (
            <>
              <div>
                <label htmlFor="auth-confirm" className={labelCls}>{t('auth.confirmLabel')}</label>
                <div className="relative">
                  <input
                    id="auth-confirm"
                    type={showConfirm ? 'text' : 'password'}
                    autoComplete="new-password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder={t('auth.passwordPlaceholder')}
                    className={`${inputCls} pr-12`}
                  />
                  <PasswordToggle id="auth-confirm" visible={showConfirm} onToggle={setShowConfirm} />
                </div>
                {touched && fieldErrors.confirm && <p className={errCls}>{fieldErrors.confirm}</p>}
              </div>
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  checked={terms}
                  onChange={(e) => setTerms(e.target.checked)}
                  className="mt-0.5 h-5 w-5 shrink-0 accent-[#D7FF3F]"
                />
                <span className="text-xs leading-relaxed text-[#9A9A9E]">{t('auth.termsLabel')}</span>
              </label>
              {touched && fieldErrors.terms && <p className={errCls}>{fieldErrors.terms}</p>}
            </>
          )}

          {mode === 'login' && (
            <button
              onClick={() => switchMode('forgot')}
              className="self-start text-sm font-semibold text-[#D7FF3F]"
            >
              {t('auth.forgotLink')}
            </button>
          )}

          {errKey && (
            <div className="rounded-xl border border-[#FF453A]/40 bg-[#FF453A]/10 p-3 text-sm text-[#FF6961]">
              <p>{t(errKey)}</p>
              {/* TEMP DEBUG — raw provider error; also skipped for mapped
                  network/domain/config codes (banner text is already specific) */}
              {debugAuthError && !['network-timeout', 'unauthorized-domain', 'config-error'].includes(error ?? '') && (
                <p className="mt-1 break-all font-mono text-[11px]">DEBUG: {debugAuthError}</p>
              )}
              {error === 'email-in-use' && (
                <button
                  onClick={() => {
                    clearError()
                    setMode('login')
                  }}
                  className="mt-2 text-sm font-bold text-[#D7FF3F]"
                >
                  {t('auth.errorEmailInUseCta')}
                </button>
              )}
              {error === 'wrong-password' && (
                <button
                  onClick={() => {
                    clearError()
                    setMode('forgot')
                  }}
                  className="mt-2 text-sm font-bold text-[#D7FF3F]"
                >
                  {t('auth.errorWrongPasswordCta')}
                </button>
              )}
            </div>
          )}

          <button
            onClick={() => void submit()}
            disabled={busy}
            className="mt-2 flex min-h-[52px] w-full items-center justify-center rounded-2xl bg-[#D7FF3F] text-base font-semibold text-black transition-opacity active:opacity-80 disabled:opacity-50"
          >
            {busy
              ? mode === 'signup'
                ? t('auth.creating')
                : t('auth.signingIn')
              : mode === 'signup'
                ? t('auth.createAccount')
                : mode === 'forgot'
                  ? t('auth.forgotCta')
                  : t('auth.signIn')}
          </button>

          {/* phase 2 — hidden unless config.auth.socialEnabled */}
          {authConfig.socialEnabled && (
            <div className="mt-2 flex flex-col gap-2">
              <div className="flex items-center gap-3">
                <div className="h-px flex-1 bg-[#2C2C2E]" />
                <span className="text-[11px] text-[#6E6E73]">{t('auth.orDivider')}</span>
                <div className="h-px flex-1 bg-[#2C2C2E]" />
              </div>
              <button className="min-h-[48px] rounded-2xl bg-[#1C1C1E] text-sm font-semibold text-white">
                {t('auth.socialGoogle')}
              </button>
              <button className="min-h-[48px] rounded-2xl bg-[#1C1C1E] text-sm font-semibold text-white">
                {t('auth.socialApple')}
              </button>
            </div>
          )}

          {mode === 'login' && (
            <div className="mt-4 rounded-2xl border border-[#2C2C2E] bg-[#161618] p-4">
              <p className="text-xs leading-relaxed text-[#9A9A9E]">{t('auth.restoreBody')}</p>
              <button
                onClick={() => void onRestore()}
                disabled={busy}
                className="mt-3 min-h-[44px] w-full rounded-xl bg-[#2C2C2E] text-sm font-semibold text-white active:bg-[#3A3A3C] disabled:opacity-50"
              >
                {t('auth.restoreCta')}
              </button>
              {restoreMsg && <p className="mt-2 text-center text-xs font-semibold text-[#32D74B]">{restoreMsg}</p>}
            </div>
          )}

          <p className="mt-2 text-center text-xs text-[#6E6E73]">
            {mode === 'login' ? (
              <>
                {t('auth.noAccount')}{' '}
                <button onClick={() => switchMode('signup')} className="font-bold text-[#D7FF3F]">
                  {t('auth.noAccountCta')}
                </button>
              </>
            ) : mode === 'signup' ? (
              <>
                {t('auth.haveAccount')}{' '}
                <button onClick={() => switchMode('login')} className="font-bold text-[#D7FF3F]">
                  {t('auth.haveAccountCta')}
                </button>
              </>
            ) : null}
          </p>
        </div>
      )}

      {/* guest mode stays — the app is fully usable without an account */}
      {!sentTo && (
        <button
          onClick={() => navigate('/explore')}
          className="mt-8 flex min-h-[48px] w-full items-center justify-center rounded-2xl border border-[#3A3A3C] text-sm font-semibold text-[#9A9A9E]"
        >
          {t('auth.continueGuest')}
        </button>
      )}
    </div>
  )
}
