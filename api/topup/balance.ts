/**
 * POST /api/topup/balance — read Jum Balance.
 */
import { withApi, sendJson } from '../lib/http'
import { topUpCtx } from './shared'
import { getBalance } from '../lib/topup-store'

export default withApi(async (body, req, res) => {
  const ctx = await topUpCtx(req)
  const uid = ctx.uid ?? (typeof body.uid === 'string' ? body.uid : null)
  if (!uid) return sendJson(res, 401, { error: 'auth_required' })
  sendJson(res, 200, { balanceUsd: await getBalance(uid) })
})
