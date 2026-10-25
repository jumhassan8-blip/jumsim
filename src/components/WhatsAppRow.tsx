import { ChevronRight, MessageCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { openWhatsApp, type SupportContext, type WhatsAppSurface } from '../lib/whatsapp'

interface Props {
  /** headline, e.g. "Chat with us on WhatsApp" */
  label: string
  /** secondary line, e.g. "Fastest support — usually replies in minutes" */
  hint?: string
  surface: WhatsAppSurface
  ctx?: SupportContext
  className?: string
}

/** Green WhatsApp Business row — one tap opens a chat with our number. */
export default function WhatsAppRow({ label, hint, surface, ctx, className = '' }: Props) {
  return (
    <button
      onClick={() => openWhatsApp(surface, ctx)}
      className={`flex min-h-[56px] w-full items-center gap-3 rounded-[14px] border border-[#25D366]/30 bg-[#25D366]/10 p-4 text-left active:bg-[#25D366]/20 ${className}`}
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#25D366]">
        <MessageCircle size={18} className="text-white" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-white">{label}</span>
        {hint && <span className="block text-xs text-[#9A9A9E]">{hint}</span>}
      </span>
      <ChevronRight size={18} className="shrink-0 text-[#D7FF3F] flip-rtl" />
    </button>
  )
}

/**
 * Compact "Need help?" footer for error/support surfaces (one-line version
 * of the row). Titles differ per surface: install failure asks "Need help?",
 * the connection-test flow asks "Still stuck?".
 */
export function NeedHelpFooter({
  surface,
  ctx,
  titleKey = 'support.needHelp',
  labelKey = 'support.chatOnWhatsApp',
  hint,
}: {
  surface: WhatsAppSurface
  ctx?: SupportContext
  titleKey?: string
  labelKey?: string
  hint?: string
}) {
  const { t } = useTranslation()
  return (
    <div className="mt-4 rounded-[14px] bg-[#1C1C1E] p-3">
      <p className="mb-2 text-xs font-semibold text-[#9A9A9E]">{t(titleKey)}</p>
      <WhatsAppRow label={t(labelKey)} hint={hint} surface={surface} ctx={ctx} />
    </div>
  )
}
