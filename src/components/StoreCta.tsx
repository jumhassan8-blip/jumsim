/**
 * StoreCta — the single buy button surface (plans, top-ups).
 *
 * Config check first: if EXPO_PUBLIC_CHECKOUT_URL is empty or still a
 * placeholder, the store is unconfigured — show a "Store opening soon"
 * state with a waitlist email capture instead of a dead button.
 * Otherwise a lime "Buy on jumesim.com" that opens the external browser
 * via checkout-link (never silent — a blocked open surfaces a link
 * sheet with Copy + retry).
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CreditCard, Rocket } from 'lucide-react'
import { checkoutConfigured, openStoreCheckout, type CheckoutLinkParams } from '../lib/checkout-link'
import { track } from '../lib/analytics'

interface Props extends CheckoutLinkParams {
  /** i18n key for the button label (defaults to country.buyOnSite) */
  labelKey?: string
  /** show the informational payment-badges row under the CTA */
  withBadges?: boolean
}

const WAITLIST_KEY = 'jum-esim:store-waitlist:v1'

export default function StoreCta({ labelKey = 'country.buyOnSite', withBadges = true, ...params }: Props) {
  const { t } = useTranslation()
  const [email, setEmail] = useState('')
  const [joined, setJoined] = useState(false)

  if (!checkoutConfigured) {
    // ── unconfigured store: honest "opening soon" state, never a dead link ──
    const join = () => {
      const e = email.trim()
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return
      try {
        const list: string[] = JSON.parse(localStorage.getItem(WAITLIST_KEY) ?? '[]')
        if (!list.includes(e)) list.push(e)
        localStorage.setItem(WAITLIST_KEY, JSON.stringify(list))
      } catch {
        /* non-fatal */
      }
      track('store_waitlist_joined', { surface: params.planId })
      setJoined(true)
    }
    return (
      <div className="flex flex-col gap-3">
        <div className="rounded-2xl border border-[#D7FF3F]/30 bg-[#D7FF3F]/5 p-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-white">
            <Rocket size={16} className="text-[#D7FF3F]" /> {t('storeCta.openingSoon')}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-[#9A9A9E]">{t('storeCta.openingSoonBody')}</p>
          {joined ? (
            <p className="mt-3 text-sm font-semibold text-[#32D74B]">{t('storeCta.waitlistJoined')}</p>
          ) : (
            <div className="mt-3 flex gap-2">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t('storeCta.emailPlaceholder')}
                aria-label={t('storeCta.emailPlaceholder')}
                className="min-h-[44px] min-w-0 flex-1 rounded-xl bg-[#1C1C1E] px-3 text-sm text-white placeholder-[#6C6C70] outline-none ring-1 ring-[#3A3A3C] focus:ring-[#D7FF3F]"
              />
              <button
                onClick={join}
                disabled={!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())}
                className="min-h-[44px] shrink-0 rounded-xl bg-[#D7FF3F] px-4 text-sm font-bold text-black disabled:opacity-50"
              >
                {t('storeCta.waitlistCta')}
              </button>
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <button
        onClick={() => openStoreCheckout(params)}
        className="min-h-[52px] w-full rounded-2xl bg-[#D7FF3F] text-base font-semibold text-black transition-opacity active:opacity-80"
      >
        {t(labelKey)}
      </button>
      {withBadges && (
        <>
          <p className="flex items-center justify-center gap-1.5 text-center text-[11px] text-[#6E6E73]">
            <CreditCard size={12} />
            {t('country.payBadges')}
          </p>
          <p className="-mt-2 text-center text-[10px] text-[#6E6E73]">{t('country.buyCompliance')}</p>
        </>
      )}
    </div>
  )
}
