import type { IncomingMessage, ServerResponse } from 'node:http'
import { sendJson, readJson } from '../lib/http'
import { isMockMode } from '../lib/orders'
import { applyUsageWebhook } from '../lib/usage'

/**
 * POST /api/webhooks/esimgo
 *
 * eSIM Go event feed. The ONLY events that matter to the guarantee are the
 * ones proving usage (or activation): each one locks the order permanently.
 *
 * LIVE: verify the webhook signature before trusting ANYTHING — an unsigned
 * usage webhook must be rejected, or an attacker could lock/refund orders:
 *   const expected = crypto.createHmac('sha256', process.env.ESIMGO_WEBHOOK_SECRET!)
 *     .update(rawBody).digest('hex')
 *   if (req.headers['x-esimgo-signature'] !== expected) → 401
 *
 * MOCK: drives the usage registry so polls and webhooks agree.
 */
export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return sendJson(res, 405, { error: 'method_not_allowed' })
  }
  let body: Record<string, unknown>
  try {
    body = await readJson(req)
  } catch {
    return sendJson(res, 400, { error: 'invalid_json' })
  }

  // Shape (both eSIM Go and our mock): { iccid, type: 'usage'|'activated'|…, usedKB? }
  const iccid = typeof body.iccid === 'string' ? body.iccid : ''
  const type = typeof body.type === 'string' ? body.type : ''
  const usedKB = typeof body.usedKB === 'number' && body.usedKB > 0 ? body.usedKB : 0

  if (!iccid || !type) {
    return sendJson(res, 400, { error: 'missing_iccid_or_type' })
  }

  console.log(
    JSON.stringify({
      type: 'esimgo_webhook',
      mock: isMockMode(),
      receivedAt: new Date().toISOString(),
      signature: req.headers['x-esimgo-signature'] ?? null,
      iccid,
      event: type,
      usedKB,
    }),
  )

  const { matched } = await applyUsageWebhook(iccid, type, usedKB)
  return sendJson(res, 200, { received: true, matched })
}
