/**
 * Call-credit wallet (Module 3).
 * Balance is drawn by the second during calls (rate/60) and expires
 * 12 months after the last top-up. Stored alongside purchases.
 */

export interface CreditTxn {
  id: string
  kind: 'pack' | 'call'
  /** pack: amount added; call: cost deducted (negative impact) */
  amount: number
  at: number
  note: string
}

export interface WalletState {
  balance: number
  /** last top-up timestamp — credit expires 12 months after it */
  lastTopUpAt: number | null
  txns: CreditTxn[]
}

export const CREDIT_TTL_MS = 365 * 24 * 60 * 60 * 1000

const WALLET_KEY = 'jum-esim:wallet:v1'

export const PACKS = [3, 5, 10, 20] as const

export function emptyWallet(): WalletState {
  return { balance: 0, lastTopUpAt: null, txns: [] }
}

export function loadWallet(): WalletState {
  try {
    const raw = localStorage.getItem(WALLET_KEY)
    if (!raw) return emptyWallet()
    const w = JSON.parse(raw) as WalletState
    // expire credit 12 months after last top-up
    if (w.lastTopUpAt !== null && Date.now() > w.lastTopUpAt + CREDIT_TTL_MS) {
      return { balance: 0, lastTopUpAt: w.lastTopUpAt, txns: w.txns }
    }
    return w
  } catch {
    return emptyWallet()
  }
}

export function saveWallet(w: WalletState): void {
  try {
    localStorage.setItem(WALLET_KEY, JSON.stringify(w))
  } catch {
    /* non-fatal */
  }
}

export function callRateExpiry(lastTopUpAt: number | null): number | null {
  return lastTopUpAt === null ? null : lastTopUpAt + CREDIT_TTL_MS
}

/** minutes affordable at a per-minute rate */
export function minutesFor(balance: number, ratePerMin: number): number {
  return ratePerMin > 0 ? Math.floor(balance / ratePerMin) : 0
}
