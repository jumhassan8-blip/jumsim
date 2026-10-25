/**
 * Fail-closed boot gate. Rendered when the Firebase public config is
 * incomplete at boot — there is no partial functionality and no fallback:
 * a single clear screen with the support path.
 */
import { CONFIG } from '../config'

export default function ServiceUnavailable() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-[#0A0A0A] px-6 text-center">
      <div className="w-full max-w-sm">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[#FF453A]/15">
          <span className="text-2xl" role="img" aria-label="unavailable">
            ⚠️
          </span>
        </div>
        <h1 className="mt-6 text-xl font-bold text-white">Service temporarily unavailable</h1>
        <p className="mt-3 text-sm leading-relaxed text-[#9A9A9E]">
          We couldn’t initialize the app. Please try again in a few minutes — if it keeps happening,
          contact support and we’ll sort it out.
        </p>
        <a
          href={`https://wa.me/${CONFIG.whatsapp.number}`}
          target="_blank"
          rel="noreferrer"
          className="mt-8 flex min-h-[48px] items-center justify-center rounded-2xl bg-[#D7FF3F] text-base font-semibold text-black"
        >
          Contact support on WhatsApp
        </a>
        <p className="mt-3 text-xs text-[#6E6E73]">{CONFIG.supportEmail}</p>
      </div>
    </div>
  )
}
