import type { AnalyticsEvent } from '../types'

const LOG_KEY = 'jum-esim:analytics:v1'
const MAX_EVENTS = 200

interface LoggedEvent {
  t: number
  event: AnalyticsEvent
  data?: Record<string, string | number | boolean>
}

export function track(event: AnalyticsEvent, data?: Record<string, string | number | boolean>): void {
  const entry: LoggedEvent = { t: Date.now(), event, data }
  // eslint-disable-next-line no-console
  console.debug('[analytics]', event, data ?? '')
  try {
    const raw = localStorage.getItem(LOG_KEY)
    const log: LoggedEvent[] = raw ? (JSON.parse(raw) as LoggedEvent[]) : []
    log.push(entry)
    localStorage.setItem(LOG_KEY, JSON.stringify(log.slice(-MAX_EVENTS)))
  } catch {
    /* non-fatal */
  }
}

export function getAnalyticsLog(): LoggedEvent[] {
  try {
    const raw = localStorage.getItem(LOG_KEY)
    return raw ? (JSON.parse(raw) as LoggedEvent[]) : []
  } catch {
    return []
  }
}
