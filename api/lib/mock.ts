/** Deterministic-ish mock generators for MOCK_MODE — shaped like the real
 *  eSIM Go / Stripe payloads so the client code path never changes when
 *  MOCK_MODE flips to false. */

const hex = (n: number): string =>
  Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join('')

const digits = (n: number): string =>
  Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join('')

export interface MockPaymentIntent {
  id: string
  clientSecret: string
  amount: number
  currency: 'usd'
  status: 'requires_confirmation' | 'succeeded'
}

export function createMockPaymentIntent(amountCents: number): MockPaymentIntent {
  const id = `pi_mock_${hex(12)}`
  return {
    id,
    clientSecret: `${id}_secret_${hex(12)}`,
    amount: amountCents,
    currency: 'usd',
    status: 'requires_confirmation',
  }
}

export interface MockEsimOrder {
  iccid: string
  matchingId: string
  smdpAddress: string
  qrUrl: string
  lpaString: string
}

export function createMockEsimOrder(topUpFor?: string): MockEsimOrder {
  const matchingId = hex(16).toUpperCase()
  const smdpAddress = (process.env.MOCK_SMDP_ADDRESS ?? 'esim.jum.app') // mock SM-DP+ — swap for lp-1.esimgo.com in live mode
  const iccid = topUpFor ?? `89852${digits(14)}`
  return {
    iccid,
    matchingId,
    smdpAddress,
    qrUrl: `https://${smdpAddress}/qr/${matchingId}.png`,
    lpaString: `LPA:1$${smdpAddress}$${matchingId}`,
  }
}

export function mockOrderId(): string {
  return `ord_${hex(12).toUpperCase()}`
}

/** A clientSecret carrying this marker simulates a declined payment —
 *  the confirm step fails with 402 and the caller voids, never captures. */
export const MOCK_DECLINED_MARKER = 'declined'
