/**
 * Rented-number state (Module 5).
 * One active rented number per user at MVP. Stored locally; the server
 * mirrors rental records and processes renewals. Grace period: N days
 * after a missed renewal, then the number is released back to inventory.
 */
import type { RentedNumber } from '../types'

const NUMBER_KEY = 'jum-esim:number:v1'

export function loadNumber(): RentedNumber | null {
  try {
    const raw = localStorage.getItem(NUMBER_KEY)
    if (!raw) return null
    return JSON.parse(raw) as RentedNumber
  } catch {
    return null
  }
}

export function saveNumber(n: RentedNumber | null): void {
  try {
    if (n) localStorage.setItem(NUMBER_KEY, JSON.stringify(n))
    else localStorage.removeItem(NUMBER_KEY)
  } catch {
    /* non-fatal */
  }
}

/** days remaining in the grace window after renewsAt passes */
export function graceDaysLeft(n: RentedNumber, gracePeriodDays: number): number | null {
  if (n.status !== 'grace') return null
  const deadline = n.renewsAt + gracePeriodDays * 24 * 60 * 60 * 1000
  return Math.max(0, Math.ceil((deadline - Date.now()) / (24 * 60 * 60 * 1000)))
}

export function graceDeadline(n: RentedNumber, gracePeriodDays: number): number {
  return n.renewsAt + gracePeriodDays * 24 * 60 * 60 * 1000
}

/** mask for display contexts where the viewer may not be the owner */
export function maskNumber(e164: string): string {
  const m = e164.match(/^(\+\d{1,3})(\d{6})(\d{3})$/)
  if (!m) return e164.slice(0, 4) + '••••'
  return `${m[1]} •••• ${m[3]}`
}
