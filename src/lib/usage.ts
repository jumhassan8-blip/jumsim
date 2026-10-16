import type { Purchase, Usage } from '../types'

export const DAY_MS = 24 * 60 * 60 * 1000
/** high-speed fair-usage cap advertised on unlimited plans */
export const UNLIMITED_FAIR_USE_MB = 50 * 1024

export function planTotalMB(p: Purchase): number {
  return p.plan.dataGB === 'unlimited'
    ? UNLIMITED_FAIR_USE_MB
    : Math.round(p.plan.dataGB * 1024)
}

/**
 * Usage is SERVER-AUTHORITATIVE. The client renders whatever the provider
 * reported (see BackendProvider.getUsage → POST /api/usage) and NEVER
 * fabricates consumption: mergeUsage folds the server readings for a base
 * eSIM and its top-ups; until a reading exists for a purchase it contributes
 * zero used (an honest "no data yet", not a made-up number).
 */
export function mergeUsage(
  base: Purchase,
  topUps: Purchase[],
  _now: number,
  readings: Map<string, Usage> = new Map(),
): Usage {
  const all = [base, ...topUps]
  const totalMB = all.reduce((s, p) => s + planTotalMB(p), 0)
  const usedMB = Math.min(
    totalMB,
    all.reduce((s, p) => s + (readings.get(p.order.iccid)?.usedMB ?? 0), 0),
  )
  const expiresAt = Math.max(
    ...all.map((p) => (p.installedAt ?? p.order.createdAt) + p.plan.days * DAY_MS),
  )
  const activatedAt = Math.min(...all.map((p) => p.installedAt ?? p.order.createdAt))
  return {
    iccid: base.order.iccid,
    usedMB,
    totalMB,
    fairUseCapMB: all.some((p) => p.plan.dataGB === 'unlimited')
      ? all.reduce((s, p) => s + planTotalMB(p), 0)
      : null,
    activatedAt,
    expiresAt,
  }
}

export type GroupedEsims = {
  base: Purchase
  topUps: Purchase[]
}[]

/** group purchases by eSIM (base order + top-ups sharing the iccid) */
export function groupByIccid(purchases: Purchase[]): GroupedEsims {
  const bases = purchases.filter((p) => !p.order.topUpFor)
  return bases.map((base) => ({
    base,
    topUps: purchases.filter(
      (p) => p.order.topUpFor === base.order.iccid && p.order.iccid === base.order.iccid,
    ),
  }))
}

export function displayStatus(
  base: Purchase,
  topUps: Purchase[],
  now: number,
): 'not_installed' | 'active' | 'expired' | 'refunded' {
  if (base.status === 'refunded') return 'refunded'
  if (base.status === 'not_installed') return 'not_installed'
  // expiry is derived from server-recorded install/creation timestamps —
  // a schedule, not a usage claim
  const merged = mergeUsage(base, topUps, now)
  return now > merged.expiresAt ? 'expired' : 'active'
}
