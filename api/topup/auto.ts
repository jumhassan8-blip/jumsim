/**
 * POST /api/topup/auto — auto top-up settings (brief §4).
 * action: 'list' | 'save' | 'delete'.
 * save: { savedNumberId, productId, cadence: 'monthly'|'weekly', dueDay, enabled }
 */
import { withApi, sendJson } from '../lib/http'
import { topUpCtx } from './shared'
import { deleteAutoTopUp, listAutoTopUps, putAutoTopUp } from '../lib/topup-store'

export default withApi(async (body, req, res) => {
  const ctx = await topUpCtx(req)
  const uid = ctx.uid ?? (typeof body.uid === 'string' ? body.uid : null)
  if (!uid) return sendJson(res, 401, { error: 'auth_required' })

  const action = typeof body.action === 'string' ? body.action : 'list'
  if (action === 'list') return sendJson(res, 200, { autoTopUps: await listAutoTopUps(uid) })
  if (action === 'delete') {
    const id = typeof body.id === 'string' ? body.id : ''
    await deleteAutoTopUp(uid, id)
    return sendJson(res, 200, { ok: true })
  }

  const savedNumberId = typeof body.savedNumberId === 'string' ? body.savedNumberId : ''
  const productId = typeof body.productId === 'string' ? body.productId : ''
  const cadence = body.cadence === 'weekly' ? 'weekly' : 'monthly'
  const dueDay = Number(body.dueDay)
  if (!savedNumberId || !productId || !Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) {
    return sendJson(res, 422, { error: 'invalid_auto_topup' })
  }
  const rec = {
    id: `at_${Date.now().toString(36)}`,
    savedNumberId,
    productId,
    cadence,
    dueDay,
    enabled: body.enabled !== false,
    lastFiredAt: null,
  }
  await putAutoTopUp(uid, rec)
  sendJson(res, 200, { ok: true, autoTopUp: rec })
})
