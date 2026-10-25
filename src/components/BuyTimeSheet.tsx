import { CreditCard } from 'lucide-react'
import { CONFIG } from '../config'
import { formatUSD } from '../lib/money'
import { checkoutConfigured, openStoreCredit } from '../lib/checkout-link'

interface Props {
  /** destination rate for the informational "≈ X min" estimates */
  ratePerMin: number
  countryName: string
  onCredited: (balanceUSD: number) => void
  onClose: () => void
}

/**
 * Buy Time sheet — required before calling without enough credit.
 *
 * Store compliance: the app NEVER charges for digital goods. This sheet is
 * informational only — packs are shown as estimates and the single CTA
 * opens jumesim.com/calls/topup in the external browser. Credit appears
 * via the server once the web payment completes.
 */
export default function BuyTimeSheet({ ratePerMin, countryName, onClose }: Props) {
  const estMin = (usd: number) => (ratePerMin > 0 ? Math.floor(usd / ratePerMin) : 0)

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end bg-black/60"
      onClick={onClose}
      role="dialog"
      aria-label="Buy call time"
    >
      <div
        className="w-full rounded-t-3xl bg-[#1C1C1E] p-5 pb-[max(1.5rem,env(safe-area-inset-bottom))]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-[#3A3A3C]" />

        <p className="text-base font-semibold text-white">Buy call time</p>
        <p className="mt-1 text-sm text-[#9A9A9E]">
          ≈ minutes are estimates for {countryName} at {formatUSD(ratePerMin)}/min.
        </p>

        <div className="mt-4 grid grid-cols-2 gap-2">
          {CONFIG.calls.packsUSD.map((usd) => (
            <div
              key={usd}
              className="flex min-h-[72px] flex-col items-center justify-center rounded-2xl bg-[#2C2C2E]"
            >
              <span className="text-lg font-bold text-white">{formatUSD(usd)}</span>
              <span className="text-[11px] text-[#9A9A9E]">≈ {estMin(usd)} min to {countryName}</span>
            </div>
          ))}
        </div>

        <button
          onClick={() => {
            if (!checkoutConfigured) return // never a dead link — see config state below
            openStoreCredit()
            onClose()
          }}
          disabled={!checkoutConfigured}
          className="mt-4 min-h-[52px] w-full rounded-2xl bg-[#D7FF3F] text-sm font-bold text-black active:opacity-80 disabled:opacity-50"
        >
          {checkoutConfigured ? 'Top up on jumesim.com' : 'Store opening soon'}
        </button>
        <p className="mt-3 flex items-center justify-center gap-1.5 text-center text-[11px] text-[#6E6E73]">
          <CreditCard size={12} />
          Apple Pay · Google Pay · Cards — secure checkout on jumesim.com
        </p>
        <p className="mt-1 text-center text-[10px] text-[#6E6E73]">
          Payment completes securely on jumesim.com — credit appears in the app.
          Call credit expires {CONFIG.calls.creditExpiresMonths} months after purchase.
        </p>
      </div>
    </div>
  )
}
