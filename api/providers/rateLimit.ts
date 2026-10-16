/**
 * eSIM Access enforces ~8 requests/second per account. Two defenses:
 *
 *  1. Token bucket — at most `capacity` requests leave immediately, the
 *     bucket refills at `refillPerSec`. Callers await acquire() before
 *     every provider call. Per-process; serverless deployments with
 *     concurrent instances should additionally set ESIMA_MAX_RPS lower
 *     per instance (a single Vercel function instance is effectively
 *     serial anyway).
 *  2. Exponential backoff — on HTTP 429/5xx or network failure, retry
 *     up to `maxAttempts` with growing delays + jitter. 4xx other than
 *     429 are permanent and throw immediately.
 */

export interface RateLimiter {
  acquire(): Promise<void>
}

export function createRateLimiter(opts: { capacity?: number; refillPerSec?: number } = {}): RateLimiter {
  const capacity = opts.capacity ?? 8
  const refillPerSec = opts.refillPerSec ?? 8
  let tokens = capacity
  let last = Date.now()

  return {
    acquire(): Promise<void> {
      const now = Date.now()
      tokens = Math.min(capacity, tokens + ((now - last) / 1000) * refillPerSec)
      last = now
      if (tokens >= 1) {
        tokens -= 1
        return Promise.resolve()
      }
      const waitMs = ((1 - tokens) / refillPerSec) * 1000
      return new Promise((resolve) => setTimeout(resolve, waitMs)).then(() => {
        tokens = Math.max(0, tokens - 1)
        last = Date.now()
        return undefined as void
      })
    },
  }
}

export interface BackoffOptions {
  /** total tries including the first (default 4) */
  maxAttempts?: number
  baseDelayMs?: number
  /** injectable for tests (defaults to setTimeout-based sleep) */
  sleep?: (ms: number) => Promise<void>
  /** retryable HTTP statuses (default [429, 500, 502, 503, 504]) */
  retryableStatuses?: number[]
  jitter?: boolean
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Run `fn` with exponential backoff. `fn` throws RetryableError to force
 * a retry, or any other Error to fail permanently. HTTP-response-shaped
 * errors with a `status` field are classified automatically.
 */
export class RetryableError extends Error {
  readonly status?: number
  constructor(message: string, status?: number) {
    super(message)
    this.name = 'RetryableError'
    this.status = status
  }
}

export async function withBackoff<T>(fn: (attempt: number) => Promise<T>, opts: BackoffOptions = {}): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? 4
  const base = opts.baseDelayMs ?? 300
  const retryable = opts.retryableStatuses ?? [429, 500, 502, 503, 504]
  const doSleep = opts.sleep ?? sleep
  const jitter = opts.jitter ?? true

  let lastErr: unknown = null
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn(attempt)
    } catch (err) {
      lastErr = err
      const status = err instanceof RetryableError ? err.status : (err as { status?: number })?.status
      const retryableStatus = status !== undefined && retryable.includes(status)
      const isRetryable = err instanceof RetryableError || retryableStatus
      if (!isRetryable || attempt === maxAttempts) break
      const delay = base * 2 ** (attempt - 1) * (jitter ? 0.5 + Math.random() : 1)
      await doSleep(delay)
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}
