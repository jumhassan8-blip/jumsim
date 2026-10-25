/**
 * Tiny pub/sub for the Top Up nav badge dot (pending scheduled top-ups).
 * TopUpPage publishes its boot-state pendingCount; TabBar subscribes.
 */

type Listener = (count: number) => void

let current = 0
const listeners = new Set<Listener>()

export const subscribeTopUpPending = Object.assign(
  (fn: Listener): (() => void) => {
    listeners.add(fn)
    return () => listeners.delete(fn)
  },
  { snapshot: (): number => current },
)

export function publishTopUpPending(count: number): void {
  current = count
  for (const fn of listeners) fn(count)
}
