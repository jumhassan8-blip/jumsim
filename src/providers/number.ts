import type { AvailableNumber, RentedNumber } from '../types'
import { CONFIG } from '../config'

/**
 * Number provider — the client only talks to the server endpoints (Twilio
 * Incoming Numbers API behind /api/numbers/*), which hold the credentials.
 * Fail closed: an unreachable backend throws (the UI shows an honest error
 * + support path) — there is no fabricated inventory.
 */

export interface NumberProvider {
  /** page is 1-based; page size 5 */
  getAvailableNumbers(countryIso: string, page: number): Promise<AvailableNumber[]>
  /** rent + start monthly billing; returns a pending-verification number */
  rentNumber(number: AvailableNumber, email: string): Promise<RentedNumber>
  /** returns true when the submitted code matches the one the server sent */
  verifyNumber(sid: string, code: string): Promise<boolean>
  /** release back to inventory pool */
  releaseNumber(sid: string): Promise<void>
  /** extend the rental by one billing period */
  renewNumber(sid: string): Promise<void>
  requestVerificationCode(sid: string): Promise<void>
}

async function req<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${CONFIG.apiUrl}/api/numbers/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw new Error(data.error ?? `http_${res.status}`)
  return data
}

export class ServerNumberProvider implements NumberProvider {
  getAvailableNumbers(countryIso: string, page: number): Promise<AvailableNumber[]> {
    return req('available', { countryIso, page })
  }
  rentNumber(number: AvailableNumber, email: string): Promise<RentedNumber> {
    return req('rent', { sid: number.sid, number: number.number, countryIso: number.countryIso, email })
  }
  verifyNumber(sid: string, code: string): Promise<boolean> {
    return req('verify', { sid, code }).then((r) => Boolean((r as { ok?: boolean }).ok))
  }
  releaseNumber(sid: string): Promise<void> {
    return req('release', { sid }).then(() => undefined)
  }
  renewNumber(sid: string): Promise<void> {
    return req('renew', { sid }).then(() => undefined)
  }
  requestVerificationCode(sid: string): Promise<void> {
    return req('code', { sid }).then(() => undefined)
  }
}

export const numberProvider: NumberProvider = new ServerNumberProvider()
