/**
 * /redeem — standalone redemption route (brief §5). Reached from the
 * delivery link (?t=<token>) or with a pre-filled code (?code=XXXX-...).
 * Conversion shown pre-confirm via /api/gift/preview; success offers the
 * "Send a gift back" loop.
 */
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams, Link } from 'react-router'
import { CheckCircle2, CircleAlert, Gift, ChevronLeft } from 'lucide-react'
import { track } from '../lib/analytics'
import {
  GiftError, hyphenateCode, isCompleteCode, previewGift, redeemGift,
  type GiftPreview, type GiftRedeemResult,
} from '../lib/gifts'

type Phase =
  | { name: 'input' }
  | { name: 'preview'; code: string; preview: GiftPreview }
  | { name: 'done'; result: GiftRedeemResult }
  | { name: 'already'; redeemedAt: number }
  | { name: 'error'; message: string }

export default function Redeem() {
  const { t } = useTranslation()
  const [params] = useSearchParams()
  const [raw, setRaw] = useState('')
  const [busy, setBusy] = useState(false)
  const [phase, setPhase] = useState<Phase>({ name: 'input' })
  const [deliveryLink, setDeliveryLink] = useState('')

  // Delivery link: ?t=<token> resolves server-side to the gift preview path
  // (the link never carries the code). Code prefill: ?code=XXXX-...
  useEffect(() => {
    const token = params.get('t')
    const pre = params.get('code')
    if (pre) {
      setRaw(pre)
      track('gift_redeem_prefilled')
    } else if (token) {
      setDeliveryLink(token)
      track('gift_redeem_link_opened')
    }
  }, [params])

  const code = hyphenateCode(raw)
  const complete = isCompleteCode(code)

  const showError = (e: unknown) => {
    const ge = e instanceof GiftError ? e : null
    if (ge?.code === 'already_redeemed') {
      setPhase({ name: 'already', redeemedAt: Number(ge.extra.redeemedAt ?? Date.now()) })
    } else if (ge?.code === 'guess_lockout') {
      setPhase({ name: 'error', message: t('gifts.redeemLockout', { mins: Math.ceil(Number(ge.extra.retryAfterSeconds ?? 3600) / 60) }) })
    } else {
      setPhase({ name: 'error', message: t('gifts.redeemInvalid') })
    }
  }

  const runPreview = async (target?: string) => {
    setBusy(true)
    try {
      const p = await previewGift(target ?? code)
      setPhase({ name: 'preview', code: target ?? code, preview: p })
    } catch (e) { showError(e) } finally { setBusy(false) }
  }

  useEffect(() => {
    // auto-validate a complete pre-filled code (delivery-link flow)
    if (complete && phase.name === 'input' && raw.length >= 16) {
      void runPreview(code)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [complete])

  const runRedeem = async () => {
    if (phase.name !== 'preview') return
    setBusy(true)
    try {
      const result = await redeemGift(phase.code)
      setPhase({ name: 'done', result })
      track('gift_redeemed_client', { type: result.type, amount: result.amount })
    } catch (e) { showError(e) } finally { setBusy(false) }
  }

  const reset = () => {
    setRaw('')
    setPhase({ name: 'input' })
    setDeliveryLink('')
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col bg-[#0A0A0A] px-4 pb-10 pt-6">
      <Link to="/gifts" className="flex items-center gap-1 text-sm text-[#9A9A9E] active:text-white">
        <ChevronLeft size={16} /> {t('gifts.backToGifts')}
      </Link>

      {phase.name === 'done' ? (
        <div className="mt-14 text-center">
          <CheckCircle2 size={56} className="mx-auto text-[#D7FF3F]" />
          <h1 className="mt-4 text-2xl font-extrabold">{t('gifts.redeemDoneTitle')}</h1>
          <p className="mt-2 text-sm text-[#9A9A9E]">{phase.result.appliedValue}</p>
          <Link
            to="/gifts?buy=1"
            className="mt-8 flex w-full items-center justify-center gap-2 rounded-2xl bg-[#D7FF3F] py-3.5 text-sm font-bold text-black active:opacity-90"
          >
            <Gift size={16} /> {t('gifts.sendBack')}
          </Link>
          <Link to="/" className="mt-3 block text-xs font-semibold text-[#9A9A9E] active:text-white">
            {t('gifts.doneClose')}
          </Link>
        </div>
      ) : (
        <>
          <h1 className="mt-8 text-2xl font-extrabold tracking-tight">{t('gifts.redeemTitle')}</h1>
          <p className="mt-1 text-sm text-[#9A9A9E]">{t('gifts.redeemBody')}</p>

          {phase.name === 'already' ? (
            <div className="mt-8 text-center">
              <CircleAlert size={48} className="mx-auto text-[#FF9F0A]" />
              <p className="mt-3 text-base font-bold">{t('gifts.redeemAlreadyTitle')}</p>
              <p className="mt-1 text-xs text-[#9A9A9E]">
                {t('gifts.redeemAlreadyBody', { when: new Date(phase.redeemedAt).toLocaleString() })}
              </p>
              <button type="button" onClick={reset} className="mt-6 w-full rounded-2xl border border-[#2C2C2E] py-3 text-sm font-semibold text-white active:bg-[#2C2C2E]">
                {t('gifts.redeemAnother')}
              </button>
            </div>
          ) : phase.name === 'preview' ? (
            <div className="mt-6 rounded-3xl border border-[#D7FF3F]/40 bg-[#1C1C1E] p-5">
              <p className="text-xs font-semibold uppercase tracking-wider text-[#D7FF3F]">{t('gifts.redeemPreviewTitle')}</p>
              <p className="mt-2 text-lg font-bold">{phase.preview.conversion}</p>
              {phase.preview.message && (
                <p className="mt-2 text-sm italic text-[#9A9A9E]">“{phase.preview.message}”</p>
              )}
              <button
                type="button"
                disabled={busy}
                onClick={runRedeem}
                className="mt-5 w-full rounded-2xl bg-[#D7FF3F] py-3.5 text-sm font-bold text-black active:opacity-90 disabled:opacity-40"
              >
                {busy ? t('common.loading') : t('gifts.redeemConfirm')}
              </button>
              <button type="button" onClick={reset} className="mt-2 w-full rounded-2xl border border-[#2C2C2E] py-3 text-sm font-semibold text-[#9A9A9E] active:bg-[#2C2C2E]">
                {t('gifts.redeemAnother')}
              </button>
            </div>
          ) : (
            <div className="mt-6">
              <input
                value={code}
                onChange={(e) => { setRaw(e.target.value); if (phase.name === 'error') setPhase({ name: 'input' }) }}
                onPaste={(e) => {
                  const text = e.clipboardData.getData('text')
                  if (text) { e.preventDefault(); setRaw(text) }
                }}
                placeholder="XXXX-XXXX-XXXX-XXXX"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                aria-label={t('gifts.redeemInputLabel')}
                className="w-full rounded-2xl border border-[#2C2C2E] bg-[#1C1C1E] px-4 py-4 text-center font-mono text-xl font-bold tracking-[0.2em] text-white outline-none focus:border-[#D7FF3F]"
              />
              {phase.name === 'error' && <p className="mt-2 text-xs text-[#FF453A]">{phase.message}</p>}
              {deliveryLink && (
                <p className="mt-2 text-xs text-[#FF9F0A]">{t('gifts.linkNeedsCode')}</p>
              )}
              <button
                type="button"
                disabled={!complete || busy}
                onClick={() => void runPreview()}
                className="mt-4 w-full rounded-2xl border border-[#D7FF3F] py-3.5 text-sm font-bold text-[#D7FF3F] active:bg-[#D7FF3F]/10 disabled:opacity-30"
              >
                {busy ? t('common.loading') : t('gifts.redeemCta')}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
