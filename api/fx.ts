import { sendJson } from './lib/http'
import { getFxTable } from './lib/fx'

/**
 * GET /api/fx          → full daily USD table { base, rates, fetchedAt, source }
 * GET /api/fx?to=TRY   → single conversion { base, to, rate, fetchedAt, source }
 *
 * The client renders all 190 currencies from this one endpoint — it never
 * talks to a FX provider itself.
 */
export default async function handler(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://x')
  const to = (url.searchParams.get('to') ?? '').toUpperCase()
  try {
    const table = await getFxTable()
    if (to) {
      const rate = table.rates[to]
      if (!rate) return sendJson(res, 404, { error: 'unknown_currency', to })
      return sendJson(res, 200, {
        base: 'USD',
        to,
        rate,
        fetchedAt: table.fetchedAt,
        source: table.source,
      })
    }
    return sendJson(res, 200, table)
  } catch {
    return sendJson(res, 500, { error: 'fx_unavailable' })
  }
}
