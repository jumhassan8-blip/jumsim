/**
 * Support context — everything the Jum Assistant (and the email fallback)
 * knows about the user's device and, when available, their order.
 *
 * Sent with every chat message as `orderContext` so the bot can give
 * SPECIFIC answers ("Your Germany 7-day plan is installed but roaming is
 * off") instead of generic scripts.
 */
import { loadPurchases } from './storage'
import { loadProgress, readOrderSetupLog, stepDone, type StepId } from './setup'
import { detectSettingsEnv } from './settings-links'

export interface OrderContext {
  orderId: string | null
  plan: string | null
  status: string | null
  country: string | null
  /** "3/6 steps · last test: passed" style summary for the bot */
  checklistProgress: string | null
  /** last connection test outcome, human-readable */
  connectionTestResults: string | null
}

const STEPS: StepId[] = ['install', 'line_on', 'roaming', 'data_line', 'apn', 'test']

export function deviceSummary(): string {
  const ua = navigator.userAgent
  const os = /iPhone|iPad|iPod/.test(ua)
    ? 'iOS'
    : /Android/.test(ua)
      ? 'Android'
      : /Windows/.test(ua)
        ? 'Windows'
        : /Mac/.test(ua)
          ? 'macOS'
          : 'Other'
  const model =
    /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android device' : 'Desktop'
  return `${os} · ${model} · ${detectSettingsEnv()}`
}

export function buildOrderContext(orderIdParam?: string | null): OrderContext {
  const purchases = loadPurchases()
  const purchase = orderIdParam
    ? purchases.find((p) => p.order.id === orderIdParam)
    : purchases[0]

  if (!purchase) {
    return {
      orderId: orderIdParam ?? null,
      plan: null,
      status: null,
      country: null,
      checklistProgress: null,
      connectionTestResults: null,
    }
  }

  const progress = loadProgress(purchase.order.iccid)
  const doneCount = STEPS.filter((s) => stepDone(progress, s)).length
  const checklistProgress = `${doneCount}/${STEPS.length} steps`
  const t = progress.lastTest
  const connectionTestResults = t
    ? t.ok
      ? `last test passed (${t.ms ?? '?'}ms)`
      : `last test FAILED${t.reason ? ` — ${t.reason}` : ''}`
    : 'no test run yet'

  return {
    orderId: purchase.order.id,
    plan: `${purchase.plan.name} (${purchase.country.name})`,
    status: purchase.status,
    country: purchase.country.name,
    checklistProgress,
    connectionTestResults,
  }
}

/** full setup history for the email fallback body */
export function supportHistoryLines(orderId: string | null): string[] {
  if (!orderId) return ['(no order on this device)']
  const log = readOrderSetupLog(orderId)
  return log.length ? log : ['(no checklist/test history recorded)']
}
