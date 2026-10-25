/**
 * Retry with exponential backoff (max 3 attempts) for provider/payment calls.
 * Transient errors (network, 5xx, 429) retry; permanent errors fail fast.
 */
export const MAX_ATTEMPTS = 3
const BASE_DELAY_MS = 400

export class PermanentError extends Error {}

export async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      if (err instanceof PermanentError) throw err
      const status =
        err instanceof Response ? err.status : (err as { status?: number })?.status
      const permanent =
        typeof status === 'number' && status >= 400 && status < 500 && status !== 429
      if (permanent || attempt === MAX_ATTEMPTS) throw err
      await new Promise((r) =>
        setTimeout(r, BASE_DELAY_MS * 2 ** (attempt - 1) + Math.random() * 100),
      )
    }
  }
  throw lastErr
}
