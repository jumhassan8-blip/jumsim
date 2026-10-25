/**
 * POST /api/topup/balance/fund — DEV/TEST ONLY helper to seed a Jum
 * Balance so the balance-pay flow is exercisable end-to-end. Requires the
 * server-to-server token; never ship enabled to a public host without
 * wrapping it (it's inert without PROVIDER_SETUP_TOKEN).
 */
import { withApi, sendJson } from '../lib/http'
import { authenticate } from '../lib/auth'
import { applyBalanceDelta, seedBalance } from '../lib/topup-store'

export default withApi(async (body, req, res) => {
  const auth = await authenticate(req)
  if (!auth || auth.kind !== 'server') return sendJson(res, 401, { error: 'unauthorized' })

  const uid = typeof body.uid === 'string' ? body.uid : null
  const amount = Number(body.amountUsd)
  if (!uid || !(amount > 0) || amount > 500) return sendJson(res, 422, { error: 'invalid_fund' })

  seedBalance(uid, 0)
  const r = await applyBalanceDelta(uid, amount, 'test-fund')
  sendJson(res, 200, { ok: r.ok, balanceUsd: r.balance })
})
