/**
 * Client-side action rate limiter (sliding window, persisted).
 * The server enforces its own limit per IP — this guards a single device.
 */
const KEY = 'jum-esim:ratelimit:v1'

type Buckets = Record<string, number[]>

function load(): Buckets {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Buckets
  } catch {
    return {}
  }
}

function save(b: Buckets): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(b))
  } catch {
    /* non-fatal */
  }
}

/**
 * Returns true if the action is allowed. `limit` events per `windowMs`.
 * Allowed calls are recorded.
 */
export function allow(action: string, limit: number, windowMs: number): boolean {
  const now = Date.now()
  const buckets = load()
  const recent = (buckets[action] ?? []).filter((t) => now - t < windowMs)
  if (recent.length >= limit) {
    buckets[action] = recent
    save(buckets)
    return false
  }
  recent.push(now)
  buckets[action] = recent
  save(buckets)
  return true
}

/** milliseconds until the next slot opens (for UI countdowns) */
export function retryAfterMs(action: string, limit: number, windowMs: number): number {
  const recent = (load()[action] ?? []).filter((t) => Date.now() - t < windowMs)
  if (recent.length < limit) return 0
  return windowMs - (Date.now() - recent[0])
}
