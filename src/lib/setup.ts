/**
 * Get-connected checklist (Module 7).
 *
 * Per-eSIM progress persisted locally (survives app reinstall — the purchase
 * record persists the same way), and every step view/complete/test result is
 * appended to the order record so support can read the exact history from the
 * order ID.
 */

export type StepId = 'install' | 'line_on' | 'roaming' | 'data_line' | 'apn' | 'test'

export interface StepRecord {
  step: StepId
  at: number
  /** 'auto' = confirmed by retest/OS state, 'manual' = user ticked it */
  how: 'auto' | 'manual'
}

export interface SetupProgress {
  done: StepRecord[]
  /** troubleshoot actions applied, for support visibility */
  fixes: Array<{ fix: string; at: number }>
  /** last connection test result */
  lastTest: { ok: boolean; ms: number | null; at: number; reason: string | null } | null
}

const KEY = (iccid: string) => `jum-esim:setup:${iccid}:v1`

export function emptyProgress(): SetupProgress {
  return { done: [], fixes: [], lastTest: null }
}

export function loadProgress(iccid: string): SetupProgress {
  try {
    const raw = localStorage.getItem(KEY(iccid))
    return raw ? (JSON.parse(raw) as SetupProgress) : emptyProgress()
  } catch {
    return emptyProgress()
  }
}

export function saveProgress(iccid: string, p: SetupProgress): void {
  try {
    localStorage.setItem(KEY(iccid), JSON.stringify(p))
  } catch {
    /* non-fatal */
  }
}

export function stepDone(p: SetupProgress, step: StepId): StepRecord | undefined {
  return p.done.find((r) => r.step === step)
}

/** mark a step done (idempotent) and append the support-visible log entry */
export function completeStep(p: SetupProgress, step: StepId, how: 'auto' | 'manual'): SetupProgress {
  if (stepDone(p, step)) return p
  return { ...p, done: [...p.done, { step, at: Date.now(), how }] }
}

export function logFix(p: SetupProgress, fix: string): SetupProgress {
  return { ...p, fixes: [...p.fixes, { fix, at: Date.now() }] }
}

export function recordTest(
  p: SetupProgress,
  result: { ok: boolean; ms: number | null; reason: string | null },
): SetupProgress {
  return { ...p, lastTest: { ...result, at: Date.now() } }
}

/** append a support-visible event to the stored order record */
export function logToOrder(orderId: string, event: string, data: Record<string, string | number | boolean>): void {
  try {
    const raw = localStorage.getItem('jum-esim:purchases:v1')
    if (!raw) return
    const purchases = JSON.parse(raw) as Array<{ order: { id: string }; setupLog?: unknown[] }>
    const target = purchases.find((x) => x.order.id === orderId)
    if (!target) return
    const log = Array.isArray(target.setupLog) ? target.setupLog : []
    log.push({ t: Date.now(), event, ...data })
    target.setupLog = log.slice(-100)
    localStorage.setItem('jum-esim:purchases:v1', JSON.stringify(purchases))
  } catch {
    /* non-fatal */
  }
}

/** human-readable setup history for support, from the order ID */
export function readOrderSetupLog(orderId: string): string[] {
  try {
    const raw = localStorage.getItem('jum-esim:purchases:v1')
    if (!raw) return []
    const purchases = JSON.parse(raw) as Array<{ order: { id: string }; setupLog?: Array<Record<string, unknown>> }>
    const target = purchases.find((x) => x.order.id === orderId)
    if (!target?.setupLog) return []
    return target.setupLog.map((e) => {
      const t = new Date(Number(e.t)).toISOString().slice(11, 19)
      const rest = Object.entries(e)
        .filter(([k]) => k !== 't')
        .map(([k, v]) => `${k}=${String(v)}`)
        .join(' ')
      return `${t} ${rest}`
    })
  } catch {
    return []
  }
}
