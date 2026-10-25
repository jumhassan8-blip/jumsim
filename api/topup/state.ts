/**
 * POST /api/topup/state — boot state for the tab.
 * { uid } → { providerConfigured, balanceUsd, savedNumbers, recents,
 *             pendingCount, autoTopUps }
 * pendingCount drives the nav badge dot (scheduled auto top-ups whose
 * due day is today and haven't fired). No provider configured → the client
 * renders the waitlist state from `providerConfigured === null`.
 */
import { withApi, sendJson } from '../lib/http'
import { topUpCtx, providerConfigured } from './shared'
import { resolveTopUpProvider } from './index'
import { getBalance, listSavedNumbers, listAutoTopUps, listTopUps } from '../lib/topup-store'

export default withApi(async (body, req, res) => {
  void body
  const ctx = await topUpCtx(req)
  const uid = ctx.uid ?? (typeof body.uid === 'string' ? body.uid : null)
  const provider = resolveTopUpProvider()

  const today = new Date()
  const dueDay = today.getDate()
  const autos = uid ? await listAutoTopUps(uid) : []
  const firedRecently = (a: { lastFiredAt: number | null }): boolean =>
    a.lastFiredAt !== null && today.getTime() - a.lastFiredAt < 20 * 60 * 60 * 1000
  const pendingCount = autos.filter(
    (a) => a.enabled && a.dueDay === dueDay && !firedRecently(a),
  ).length

  const recents = uid ? await listTopUps(uid, 5) : []
  const balance = uid ? await getBalance(uid) : 0

  sendJson(res, 200, {
    providerConfigured: provider ? providerConfigured() : null,
    balanceUsd: balance,
    savedNumbers: uid ? await listSavedNumbers(uid) : [],
    recents,
    pendingCount,
    autoTopUps: autos,
    uid,
  })
})
