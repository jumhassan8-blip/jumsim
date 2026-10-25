/**
 * POST /api/checkout/email-instructions — re-send install instructions
 * from the success page ("Install instructions to my email").
 *
 * Body: { email, order: { orderId?, planId?, lpaString?, qrUrl?, name? } }
 *
 * Sends via SendGrid REST API (no SDK dependency). Without
 * SENDGRID_API_KEY the endpoint returns 503 and the page shows its
 * graceful fallback (support email). The eSIM was already delivered at
 * purchase time via Stripe's receipt + the success page itself — this is
 * a convenience re-send, never the only copy.
 */
import { withApi, sendJson } from '../lib/http'

const INSTALL_HTML = (order: Record<string, unknown>) => {
  const lpa = String(order.lpaString ?? '')
  const plan = String(order.name ?? order.planId ?? 'your eSIM')
  const orderRef = String(order.orderId ?? '')
  const lpaBlock = lpa
    ? `<p style="font-family:monospace;background:#1C1C1E;color:#D7FF3F;padding:12px;border-radius:8px;word-break:break-all">${lpa}</p>
       <p>Copy the code above, then on your iPhone go to <b>Settings → Cellular → Add eSIM → Use QR Code</b> and choose "Enter Details Manually". On Android: <b>Settings → Network → SIMs → Add eSIM</b>.</p>`
    : `<p>Open the Jum e-SIM app and your eSIM install QR will be there — or reply to this email and we'll resend it.</p>`
  return `<div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;max-width:520px;margin:0 auto;color:#111">
    <h2 style="color:#B7E22E">Your Jum e-SIM install instructions</h2>
    <p>Thanks for your purchase of <b>${plan}</b>${orderRef ? ` (order ${orderRef})` : ''}.</p>
    ${lpaBlock}
    <p style="color:#666;font-size:12px">Need help? Reply to this email or write to support@jumesim.com — we answer fast.</p>
  </div>`
}

export default withApi(async (body, _req, res) => {
  const email = String(body.email ?? '').trim()
  const order = (body.order ?? {}) as Record<string, unknown>
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    sendJson(res, 400, { error: 'invalid_email' })
    return
  }
  const key = process.env.SENDGRID_API_KEY
  if (!key) {
    sendJson(res, 503, { error: 'mail_unavailable' })
    return
  }
  try {
    const r = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: { email: 'support@jumesim.com', name: 'Jum e-SIM' },
        reply_to: { email: 'support@jumesim.com' },
        personalizations: [{ to: [{ email }] }],
        subject: 'Your eSIM install instructions — Jum e-SIM',
        content: [{ type: 'text/html', value: INSTALL_HTML(order) }],
      }),
    })
    if (!r.ok) {
      console.warn('[checkout/email-instructions] sendgrid', r.status)
      sendJson(res, 502, { error: 'send_failed' })
      return
    }
    sendJson(res, 200, { ok: true })
  } catch (err) {
    console.warn('[checkout/email-instructions] failed:', err)
    sendJson(res, 502, { error: 'send_failed' })
  }
})
