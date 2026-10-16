import { useEffect } from 'react'
import { Star } from 'lucide-react'
import { track } from '../lib/analytics'
import { flagFor } from '../lib/flags'
import {
  markPromptDismissed,
  markPromptShown,
  markRated,
  ratingSupportPrefill,
  requestStoreReview,
} from '../lib/rating'
import { openWhatsApp } from '../lib/whatsapp'
import { formatPlanSize } from '../lib/money'

interface Props {
  orderId: string
  /** plan summary chip: 🇩🇪 Germany · 5GB · 30 days */
  chip: string
  /** closes the sheet (and lets Installation resume its auto-navigation) */
  onClose: () => void
}

/**
 * Post-purchase rating prompt — shown at the "Installation successful!" moment.
 * 4–5 stars → store review; 1–3 stars → WhatsApp support chat (never the
 * store — that split is deliberate). "Maybe later" dismisses and anchors the
 * 90-day global cap.
 */
export default function RatingSheet({ orderId, chip, onClose }: Props) {
  // eligibility was checked before mounting; consume the one-prompt-per-order
  // quota the moment the sheet renders (guards against remounts)
  useEffect(() => {
    markPromptShown(orderId)
    track('rating_prompt_shown', { orderId })
  }, [orderId])

  const rate = (stars: number) => {
    if (stars >= 4) {
      // happy users → the store, one tap
      markRated()
      track('rating_store_opened', { stars, orderId })
      requestStoreReview()
      onClose()
      return
    }
    // unhappy users → us. NO store redirect for 1–3 stars.
    track('rating_support_routed', { stars, orderId })
    openWhatsApp('profile', undefined, ratingSupportPrefill(stars))
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60"
      role="dialog"
      aria-modal="true"
      aria-label="Rate Jum e-SIM"
    >
      <div className="w-full max-w-md rounded-t-[24px] border-t border-[#2C2C2E] bg-[#161618] px-6 pb-8 pt-6">
        <h2 className="text-center text-xl font-semibold text-white">Enjoying Jum e-SIM?</h2>
        <p className="mt-2 text-center">
          <span className="inline-block rounded-full bg-[#2C2C2E] px-3 py-1 text-xs font-medium text-[#D7FF3F]">
            {chip}
          </span>
        </p>
        <div className="mt-6 flex justify-center gap-3" role="radiogroup" aria-label="Rating">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              role="radio"
              aria-checked="false"
              aria-label={`${n} star${n > 1 ? 's' : ''}`}
              onClick={() => rate(n)}
              className="rounded-full p-1 transition-transform active:scale-90"
            >
              <Star size={40} className="text-[#6E6E73]" fill="none" strokeWidth={1.5} />
            </button>
          ))}
        </div>
        <p className="mt-4 text-center text-xs text-[#6E6E73]">
          Great! One tap to rate us — or tell us what went wrong.
        </p>
        <button
          onClick={() => {
            markPromptDismissed()
            track('rating_dismissed', { orderId })
            onClose()
          }}
          className="mt-6 flex min-h-[44px] w-full items-center justify-center rounded-full text-sm font-semibold text-[#9A9A9E]"
        >
          Maybe later
        </button>
      </div>
    </div>
  )
}

/** chip text helper: 🇩🇪 Germany · 5GB · 30 days */
export function ratingChip(
  countryName: string,
  iso2: string,
  dataGB: number | 'unlimited',
  days: number,
): string {
  return `${flagFor(iso2)} ${countryName} · ${formatPlanSize(dataGB)} · ${days} days`
}
