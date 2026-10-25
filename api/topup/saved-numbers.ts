/**
 * POST /api/topup/saved-numbers — My Line persistence.
 * Action via body.action: 'list' | 'save' | 'delete'.
 * save: { msisdn, countryIso, operatorName?, nickname }
 */
import { withApi, sendJson } from '../lib/http'
import { topUpCtx } from './shared'
import { deleteSavedNumber, listSavedNumbers, saveNumber } from '../lib/topup-store'

export default withApi(async (body, req, res) => {
  const ctx = await topUpCtx(req)
  const uid = ctx.uid ?? (typeof body.uid === 'string' ? body.uid : null)
  if (!uid) return sendJson(res, 401, { error: 'auth_required' })

  const action = typeof body.action === 'string' ? body.action : 'list'
  if (action === 'list') {
    return sendJson(res, 200, { savedNumbers: await listSavedNumbers(uid) })
  }
  if (action === 'delete') {
    const id = typeof body.id === 'string' ? body.id : ''
    await deleteSavedNumber(uid, id)
    return sendJson(res, 200, { ok: true })
  }
  // save (upsert on msisdn)
  const msisdn = typeof body.msisdn === 'string' ? body.msisdn.replace(/\D/g, '') : ''
  const countryIso = typeof body.countryIso === 'string' ? body.countryIso.toUpperCase() : ''
  const nickname = typeof body.nickname === 'string' ? body.nickname.trim().slice(0, 40) : ''
  if (msisdn.length < 8 || !/^[A-Z]{2}$/.test(countryIso)) {
    return sendJson(res, 422, { error: 'invalid_number' })
  }
  const rec = await saveNumber(uid, {
    msisdn,
    countryIso,
    operatorName: typeof body.operatorName === 'string' ? body.operatorName : null,
    nickname: nickname || 'My line',
    lastProductId: typeof body.lastProductId === 'string' ? body.lastProductId : null,
  })
  sendJson(res, 200, { ok: true, savedNumber: rec })
})
