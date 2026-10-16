import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import {
  Activity,
  CheckCircle2,
  ChevronDown,
  Circle,
  Copy,
  ExternalLink,
  Info,
  LifeBuoy,
  PartyPopper,
  Plane,
  RotateCcw,
  Wifi,
  XCircle,
} from 'lucide-react'
import { CONFIG } from '../config'
import { useStore } from '../state/StoreContext'
import { track } from '../lib/analytics'
import { useGuarantee } from '../lib/guarantee'
import RefundCta from '../components/RefundCta'
import { useTranslation } from 'react-i18next'
import { formatPlanSize } from '../lib/money'
import { usePrice } from '../lib/use-price'
import { PACKS } from '../lib/wallet'
import { FlowHeader, ErrorState, Badge } from '../components/ui-bits'
import { NeedHelpFooter } from '../components/WhatsAppRow'
import {
  detectSettingsEnv,
  tryOpenSettings,
  type SettingsEnv,
} from '../lib/settings-links'
import {
  completeStep,
  loadProgress,
  logFix,
  logToOrder,
  recordTest,
  saveProgress,
  stepDone,
  type SetupProgress,
  type StepId,
} from '../lib/setup'

type Status = 'not_installed' | 'installed' | 'connected'

interface Step {
  id: StepId
  title: string
  why: string
  ios: string
  android: string
  iosLink?: string
  androidLink?: string
  critical?: boolean
}

type TFn = (k: string, o?: Record<string, unknown>) => string

function buildSteps(t: TFn): Step[] {
  return [
    {
      id: 'install',
      title: t('setup.step.install.title'),
      why: t('setup.step.install.why'),
      ios: t('setup.step.install.ios'),
      android: t('setup.step.install.android'),
    },
    {
      id: 'line_on',
      title: t('setup.step.line_on.title'),
      why: t('setup.step.line_on.why'),
      ios: t('setup.step.line_on.ios'),
      android: t('setup.step.line_on.android'),
      iosLink: 'app-settings:',
      androidLink: 'intent:#Intent;action=android.settings.WIRELESS_SETTINGS;end',
    },
    {
      id: 'roaming',
      title: t('setup.step.roaming.title'),
      why: t('setup.step.roaming.why'),
      ios: t('setup.step.roaming.ios'),
      android: t('setup.step.roaming.android'),
      iosLink: 'App-Prefs:ROOT=CELLULAR',
      androidLink: 'android.settings.DATA_ROAMING_SETTINGS',
      critical: true,
    },
    {
      id: 'data_line',
      title: t('setup.step.data_line.title'),
      why: t('setup.step.data_line.why'),
      ios: t('setup.step.data_line.ios'),
      android: t('setup.step.data_line.android'),
      iosLink: 'app-settings:',
      androidLink: 'intent:#Intent;action=android.settings.DATA_USAGE_SETTINGS;end',
    },
    {
      id: 'apn',
      title: t('setup.step.apn.title'),
      why: t('setup.step.apn.why'),
      ios: t('setup.step.apn.ios'),
      android: t('setup.step.apn.android'),
    },
    {
      id: 'test',
      title: t('setup.step.test.title'),
      why: t('setup.step.test.why'),
      ios: t('setup.step.test.ios'),
      android: t('setup.step.test.android'),
    },
  ]
}

function buildFixes(t: TFn): ReadonlyArray<{ id: string; label: string; detail: string }> {
  return [
    { id: 'airplane', label: t('setup.fix.airplane.label'), detail: t('setup.fix.airplane.detail') },
    { id: 'roaming_toggle', label: t('setup.fix.roaming_toggle.label'), detail: t('setup.fix.roaming_toggle.detail') },
    { id: 'network_select', label: t('setup.fix.network_select.label'), detail: t('setup.fix.network_select.detail') },
    { id: 'apn_manual', label: t('setup.fix.apn_manual.label'), detail: t('setup.fix.apn_manual.detail') },
  ]
}

const isAndroid = () => /android/i.test(navigator.userAgent)

export default function GetConnected() {
  const { orderId = '' } = useParams()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const price = usePrice()
  const { purchases, buyCreditPack, toast } = useStore()
  const purchase = purchases.find((p) => p.order.id === orderId)
  const STEPS = useMemo(() => buildSteps(t as TFn), [t])
  const FIXES = useMemo(() => buildFixes(t as TFn), [t])

  const [progress, setProgress] = useState<SetupProgress>(() =>
    purchase ? loadProgress(purchase.order.iccid) : { done: [], fixes: [], lastTest: null },
  )
  const [openStep, setOpenStep] = useState<StepId | null>(null)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<SetupProgress['lastTest']>(null)
  const [tzNotice, setTzNotice] = useState(false)
  // settings-deep-link environment + per-step failure / launcher-unavailable state
  const [env] = useState<SettingsEnv>(() => detectSettingsEnv())
  const [openFailed, setOpenFailed] = useState<Record<string, boolean>>({})
  const [launcherUnavailable, setLauncherUnavailable] = useState<Record<string, boolean>>({})

  const status: Status = useMemo(() => {
    if (stepDone(progress, 'test') && progress.lastTest?.ok) return 'connected'
    if (purchase && purchase.status !== 'not_installed') return 'installed'
    return 'not_installed'
  }, [progress, purchase])

  useEffect(() => {
    if (!purchase) return
    // step 1 auto-completes from the OS/app state
    if (purchase.status !== 'not_installed' && !stepDone(progress, 'install')) {
      const next = completeStep(progress, 'install', 'auto')
      setProgress(next)
      saveProgress(purchase.order.iccid, next)
      logToOrder(orderId, 'setup_step_completed', { step: 'install', how: 'auto' })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [purchase])

  useEffect(() => {
    if (!purchase || purchase.status === 'not_installed') return
    // landed abroad? timezone differs from home-tz and the eSIM isn't connected yet
    const homeTz = localStorage.getItem('jum-esim:home-tz')
    const nowTz = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (!homeTz) {
      localStorage.setItem('jum-esim:home-tz', nowTz)
    } else if (homeTz !== nowTz && status !== 'connected') {
      setTzNotice(true)
      logToOrder(orderId, 'tz_abroad_detected', { homeTz, nowTz })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [purchase])

  if (!purchase) {
    return (
      <div className="min-h-dvh bg-[#0A0A0A]">
        <FlowHeader title={t('setup.title')} onBack={() => navigate('/profile')} />
        <main className="mx-auto max-w-3xl px-4 pt-4">
          <ErrorState message={t('setup.orderNotFound')} onRetry={() => navigate('/')} />
        </main>
      </div>
    )
  }

  const { order, plan, country } = purchase
  // server-authoritative: ANY usage kills the guarantee banner permanently
  const guarantee = useGuarantee([order.id])[order.id]

  const update = (next: SetupProgress) => {
    setProgress(next)
    saveProgress(order.iccid, next)
  }

  const markStep = (step: StepId, how: 'auto' | 'manual') => {
    if (stepDone(progress, step)) return
    track('setup_step_completed', { orderId: order.id, step, how })
    logToOrder(order.id, 'setup_step_completed', { step, how })
    update(completeStep(progress, step, how))
  }

  const viewStep = (step: StepId) => {
    if (openStep !== step) {
      track('setup_step_viewed', { orderId: order.id, step })
      logToOrder(order.id, 'setup_step_viewed', { step })
    }
    setOpenStep(openStep === step ? null : step)
  }

  // Guarded open — the web equivalent of Linking.canOpenURL → openURL.
  // Never silently fails: a rejected or false probe flips the step into its
  // inline manual-path fallback, and Android hides the button entirely when
  // the intent launcher can't fire (no broken buttons in any environment).
  const openSettings = async (step: Step) => {
    const link = isAndroid() ? step.androidLink : step.iosLink
    if (!link) return
    const attempt = await tryOpenSettings(link).catch(() => ({ ok: false }))
    if (!attempt.ok) {
      setOpenFailed((s) => ({ ...s, [step.id]: true }))
      if (isAndroid()) setLauncherUnavailable((s) => ({ ...s, [step.id]: true }))
      logToOrder(order.id, 'settings_open_failed', { step: step.id, url: link })
    }
  }

  const runTest = async () => {
    setTesting(true)
    track('setup_step_viewed', { orderId: order.id, step: 'test' })
    const started = performance.now()
    let ok = false
    let reason: string | null = null
    try {
      // ping our own server through the data line; the probe path answers fast
      const res = await fetch(`${CONFIG.apiUrl}/health`, {
        cache: 'no-store',
        signal: AbortSignal.timeout(8000),
      })
      ok = res.ok
      if (!ok) reason = `probe_${res.status}`
    } catch {
      // Web can't force traffic over the cellular line — a failed probe on a
      // desktop browser means "unknown", not "broken". We surface the
      // troubleshooter honestly instead of faking success.
      reason = 'probe_unreachable'
    }
    const ms = Math.round(performance.now() - started)

    // A passed test marks the current step and the test step complete
    if (ok) {
      const idx = STEPS.findIndex((s) => !stepDone(progress, s.id))
      const step = idx >= 0 ? STEPS[idx].id : 'test'
      const next = completeStep(completeStep(recordTest(progress, { ok, ms, reason }), step, 'auto'), 'test', 'auto')
      update(next)
      track('connection_test_passed', { orderId: order.id, ms })
      logToOrder(order.id, 'connection_test_passed', { ms, step })
    } else {
      update(recordTest(progress, { ok, ms, reason }))
      track('connection_test_failed', { orderId: order.id, step: 'test', reason: reason ?? 'unknown' })
      logToOrder(order.id, 'connection_test_failed', { reason: reason ?? 'unknown', ms })
    }
    setTestResult({ ok, ms, reason, at: Date.now() })
    setTesting(false)
  }

  const applyFix = (fix: (typeof FIXES)[number]['id'], label: string) => {
    track('troubleshoot_fix_applied', { orderId: order.id, fix })
    logToOrder(order.id, 'troubleshoot_fix_applied', { fix })
    update(logFix(progress, label))
    toast(t('setup.toastFixApplied', { label }), 'info')
  }

  const copyOrderId = async () => {
    try {
      await navigator.clipboard.writeText(order.id)
      toast(t('setup.toastOrderCopied'), 'success')
    } catch {
      toast(t('setup.toastOrderId', { id: order.id }), 'info')
    }
  }

  const failed = testResult && !testResult.ok
  const nextStepIdx = STEPS.findIndex((s) => !stepDone(progress, s.id))

  return (
    <div className="flex min-h-dvh flex-col bg-[#0A0A0A]">
      <FlowHeader title={t('setup.title')} onBack={() => navigate(-1)} />

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pt-4">
        {/* header: flag + plan + live status chip */}
        <div className="mb-2 flex items-center gap-3">
          <span className="text-3xl">{country.flag}</span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-white">
              {t('home.planMeta', { size: formatPlanSize(plan.dataGB), days: plan.days })}
            </p>
            <p className="text-xs text-[#9A9A9E]">{country.name}</p>
          </div>
          {status === 'not_installed' && <Badge>{t('setup.chipNotInstalled')}</Badge>}
          {purchase.status === 'refunded' && (
            <span className="rounded-full bg-[#3A3A3C] px-2.5 py-1 text-[10px] font-bold text-[#9A9A9E]">
              {t('refund.refundedTerminated')}
            </span>
          )}
          {status === 'installed' && (
            <span className="rounded-full bg-[#D7FF3F]/15 px-2.5 py-1 text-[10px] font-bold text-[#D7FF3F]">
              {t('setup.chipInstalled')}
            </span>
          )}
          {status === 'connected' && (
            <span className="rounded-full bg-[#32D74B]/15 px-2.5 py-1 text-[10px] font-bold text-[#32D74B]">
              {t('setup.chipConnected')}
            </span>
          )}
        </div>

        {/* abroad nudge — web stand-in for the push */}
        {tzNotice && (
          <div className="mb-3 flex items-center gap-3 rounded-[14px] border border-[#D7FF3F]/30 bg-[#D7FF3F]/5 p-3">
            <Plane size={18} className="shrink-0 text-[#D7FF3F]" />
            <p className="min-w-0 flex-1 text-xs text-[#EBEBF0]">
              {t('setup.tzNotice')}
            </p>
            <button
              onClick={() => {
                setTzNotice(false)
                setOpenStep(nextStepIdx >= 0 ? STEPS[nextStepIdx].id : 'test')
              }}
              className="min-h-[44px] shrink-0 rounded-full bg-[#D7FF3F] px-4 text-xs font-bold text-black"
            >
              {t('setup.connectCta')}
            </button>
          </div>
        )}

        {/* dev-mode banner — deep links can't fire in a browser tab */}
        {env === 'preview' && (
          <div className="mb-3 flex items-center gap-2 rounded-[14px] border border-[#FF9F0A]/30 bg-[#FF9F0A]/5 p-3">
            <Info size={16} className="shrink-0 text-[#FF9F0A]" />
            <p className="text-xs leading-relaxed text-[#EBEBF0]">
              {t('setup.previewNote')}
            </p>
          </div>
        )}

        {/* checklist */}
        <div className="flex flex-col gap-2">
          {STEPS.map((step, i) => {
            const done = Boolean(stepDone(progress, step.id))
            const isNext = i === nextStepIdx
            const open = openStep === step.id || (isNext && openStep === null && i === 0)
            return (
              <div
                key={step.id}
                className={`rounded-[14px] transition-colors ${
                  done ? 'bg-[#161617]' : 'bg-[#1C1C1E]'
                }`}
              >
                <button
                  onClick={() => viewStep(step.id)}
                  aria-expanded={open}
                  className="flex min-h-[56px] w-full items-center gap-3 p-4 text-left"
                >
                  {done ? (
                    <CheckCircle2 size={20} className="shrink-0 text-[#D7FF3F]" />
                  ) : (
                    <Circle size={20} className="shrink-0 text-[#3A3A3C]" />
                  )}
                  <span
                    className={`flex-1 text-sm font-semibold ${
                      done ? 'text-[#6E6E73] line-through' : 'text-white'
                    }`}
                  >
                    {i + 1}. {step.title}
                    {step.critical && !done && (
                      <span className="ml-2 rounded-full bg-[#FF9F0A]/15 px-2 py-0.5 text-[9px] font-bold text-[#FF9F0A]">
                        {t('setup.commonFix')}
                      </span>
                    )}
                  </span>
                  <ChevronDown
                    size={16}
                    className={`shrink-0 text-[#9A9A9E] transition-transform ${open ? 'rotate-180' : ''}`}
                  />
                </button>

                {open && !done && (
                  <div className="px-4 pb-4">
                    {step.critical && (
                      <p className="mb-2 rounded-xl bg-[#D7FF3F]/5 p-2.5 text-xs leading-relaxed text-[#D7FF3F]">
                        {step.why}
                      </p>
                    )}
                    {!step.critical && (
                      <p className="mb-2 text-xs leading-relaxed text-[#9A9A9E]">{step.why}</p>
                    )}
                    <p className="text-xs text-[#9A9A9E]">
                      <span className="font-semibold text-white">
                        {isAndroid() ? t('setup.deviceAndroid') : t('setup.deviceIphone')}:
                      </span>{' '}
                      {isAndroid() ? step.android : step.ios}
                    </p>
                    <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                      {!stepDone(progress, step.id) && step.id !== 'test' && (
                        <button
                          onClick={() => markStep(step.id, 'manual')}
                          className="min-h-[44px] rounded-xl bg-[#D7FF3F] px-4 text-xs font-bold text-black"
                        >
                          {t('setup.doneNext')}
                        </button>
                      )}
                      {(step.iosLink || step.androidLink) && env !== 'preview' && (
                        <div className="flex flex-col gap-1.5">
                          {!launcherUnavailable[step.id] && (
                            <button
                              onClick={() => void openSettings(step)}
                              className="flex min-h-[44px] items-center gap-1.5 rounded-xl bg-[#2C2C2E] px-4 text-xs font-semibold text-white"
                            >
                              <ExternalLink size={12} />
                              {env === 'android-device' ? t('setup.openNetworkSettings') : t('setup.openSettings')}
                            </button>
                          )}
                          {env === 'ios-device' && !openFailed[step.id] && (
                            <p className="text-[11px] text-[#9A9A9E]">
                              {t('setup.youllSee')}
                            </p>
                          )}
                          {openFailed[step.id] && (
                            <p className="rounded-xl bg-[#FF9F0A]/10 p-2.5 text-xs leading-relaxed text-[#FF9F0A]">
                              {t('setup.openFailed')}
                              <span className="font-semibold">
                                {isAndroid() ? t('setup.fallbackAndroid') : t('setup.fallbackIos')}
                              </span>
                            </p>
                          )}
                        </div>
                      )}
                      {(step.iosLink || step.androidLink) && env === 'preview' && (
                        <div className="rounded-xl border border-[#3A3A3C] bg-[#161617] p-3">
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-[#9A9A9E]">
                            {t('setup.onYourPhone')}
                          </p>
                          <p className="mt-1.5 text-xs leading-relaxed text-[#EBEBF0]">
                            <span className="font-semibold text-white">{t('setup.deviceIphone')}:</span> {step.ios}
                          </p>
                          <p className="mt-1 text-xs leading-relaxed text-[#EBEBF0]">
                            <span className="font-semibold text-white">{t('setup.deviceAndroid')}:</span> {step.android}
                          </p>
                        </div>
                      )}
                      {step.id === 'test' && (
                        <button
                          onClick={() => void runTest()}
                          disabled={testing}
                          className="flex min-h-[48px] items-center gap-2 rounded-xl bg-[#D7FF3F] px-5 text-sm font-bold text-black disabled:opacity-50"
                        >
                          {testing ? (
                            <Activity size={16} className="animate-spin" />
                          ) : (
                            <Wifi size={16} />
                          )}
                          {testing ? t('setup.testing') : t('setup.testCta')}
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* test result + reassure / troubleshoot */}
        {testResult?.ok && (
          <div className="mt-4 rounded-[14px] border border-[#32D74B]/40 bg-[#32D74B]/10 p-4 text-center">
            <PartyPopper size={22} className="mx-auto text-[#32D74B]" />
            <p className="mt-2 text-sm font-semibold text-white">
              {t('setup.connectedLine', { ms: testResult.ms, country: country.name })}
            </p>
            <p className="mt-1 text-xs text-[#9A9A9E]">
              {t('setup.balanceNote')}
            </p>
            <button
              onClick={() => toast(t('setup.toastAllSet', { country: country.name }), 'success')}
              className="mt-3 min-h-[44px] rounded-xl bg-[#D7FF3F] px-5 text-xs font-bold text-black"
            >
              {t('setup.startBrowsing')}
            </button>
          </div>
        )}

        {failed && (
          <div className="mt-4 rounded-[14px] border border-[#FF453A]/40 bg-[#FF453A]/10 p-4">
            <p className="flex items-center gap-2 text-sm font-semibold text-[#FF6961]">
              <XCircle size={16} /> {t('setup.testFailed')}
              {testResult.reason && (
                <span className="rounded bg-[#FF453A]/20 px-1.5 py-0.5 font-mono text-[10px]">
                  {testResult.reason}
                </span>
              )}
            </p>
            <p className="mb-3 mt-1 text-xs text-[#9A9A9E]">
              {t('setup.fixesIntro')}
            </p>
            {purchase.status === 'not_installed' && (
              <div className="mb-3 rounded-xl border border-[#D7FF3F]/30 bg-[#D7FF3F]/5 p-3">
                <RefundCta purchase={purchase} guarantee={guarantee} />
              </div>
            )}
            <div className="flex flex-col gap-2">
              {FIXES.map((f) => (
                <div key={f.id} className="rounded-xl bg-[#1C1C1E] p-3">
                  <p className="text-xs font-semibold text-white">{f.label}</p>
                  <p className="mt-0.5 text-[11px] text-[#9A9A9E]">{f.detail}</p>
                  <div className="mt-2 flex gap-2">
                    <button
                      onClick={() => applyFix(f.id, f.label)}
                      className="min-h-[40px] rounded-lg bg-[#2C2C2E] px-3 text-[11px] font-semibold text-white"
                    >
                      {t('setup.iDidThis')}
                    </button>
                    <button
                      onClick={() => void runTest()}
                      className="flex min-h-[40px] items-center gap-1.5 rounded-lg bg-[#D7FF3F] px-3 text-[11px] font-bold text-black"
                    >
                      <RotateCcw size={12} /> {t('setup.retest')}
                    </button>
                  </div>
                </div>
              ))}
              {/* expired plan → top-up inline, not an error */}
              <div className="rounded-xl bg-[#1C1C1E] p-3">
                <p className="text-xs font-semibold text-white">{t('setup.expiredTitle')}</p>
                <p className="mt-0.5 text-[11px] text-[#9A9A9E]">
                  {t('setup.expiredBody')}
                </p>
                <div className="mt-2 flex gap-2">
                  {PACKS.slice(0, 3).map((a) => (
                    <button
                      key={a}
                      onClick={() => {
                        buyCreditPack(a)
                        toast(t('wallet.creditAdded', { price: price(a) }), 'success')
                      }}
                      className="min-h-[40px] rounded-lg bg-[#2C2C2E] px-3 text-[11px] font-bold text-white"
                    >
                      {price(a)}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* skip */}
        {status !== 'connected' && (
          <button
            onClick={() => navigate('/profile')}
            className="mt-4 w-full py-2 text-center text-xs font-semibold text-[#6E6E73]"
          >
            {t('setup.skip')}
          </button>
        )}
      </main>

      {/* support safety net on every screen of the flow */}
      <footer className="mx-auto w-full max-w-3xl px-4 pb-8">
        <div className="flex items-center gap-2 rounded-[14px] bg-[#1C1C1E] p-3">
          <LifeBuoy size={16} className="shrink-0 text-[#D7FF3F]" />
          <p className="min-w-0 flex-1 text-[11px] text-[#9A9A9E]">
            {t('setup.stuckFooter', { email: CONFIG.supportEmail })}
          </p>
          <button
            onClick={() => void copyOrderId()}
            className="flex min-h-[44px] items-center gap-1.5 rounded-lg bg-[#2C2C2E] px-3 text-[11px] font-semibold text-white"
          >
            <Copy size={12} /> {t('setup.copyOrderId')}
          </button>
          <a
            href={`mailto:${CONFIG.supportEmail}?subject=${encodeURIComponent(
              t('setup.mailSubject', { id: order.id }),
            )}&body=${encodeURIComponent(
              t('setup.mailBody', {
                id: order.id,
                fixes:
                  progress.fixes.map((f) => `- ${f.fix}`).join('\n') ||
                  t('setup.mailNothing'),
              }),
            )}`}
            onClick={() => {
              track('support_opened_from_setup', { orderId: order.id })
              logToOrder(order.id, 'support_opened_from_setup', {})
            }}
            className="flex min-h-[44px] items-center rounded-lg bg-[#D7FF3F] px-3 text-[11px] font-bold text-black"
          >
            {t('setup.getHelp')}
          </a>
        </div>
        <NeedHelpFooter
          surface="connection_fail"
          titleKey="support.stillStuck"
          labelKey="support.chatWhatsAppShort"
          ctx={{ orderId: order.id, plan: purchase?.plan.name, country: purchase?.country.name }}
        />
      </footer>
    </div>
  )
}
