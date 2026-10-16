import type { ReactNode } from 'react'
import { ArrowLeft, RefreshCw, Share, Wifi } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { CONFIG } from '../config'

export function Badge({
  children,
  tone = 'lime',
}: {
  children: ReactNode
  tone?: 'lime' | 'outline' | 'red'
}) {
  const styles = {
    lime: 'bg-[#D7FF3F] text-black',
    outline: 'border border-[#D7FF3F]/50 text-[#D7FF3F]',
    red: 'bg-[#FF453A]/15 text-[#FF6961]',
  } as const
  return (
    <span
      className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${styles[tone]}`}
    >
      {children}
    </span>
  )
}

export function FiveGChip() {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-[#D7FF3F]/10 px-1.5 py-0.5 text-[10px] font-bold text-[#D7FF3F]">
      <Wifi size={10} strokeWidth={2.5} /> 5G
    </span>
  )
}

/** back header for pushed screens */
export function FlowHeader({
  title,
  onBack,
  onShare,
  right,
}: {
  title: string
  onBack: () => void
  onShare?: () => void
  right?: ReactNode
}) {
  const { t } = useTranslation()
  return (
    <header className="sticky top-0 z-40 border-b border-[#2A2A2C] bg-[#0A0A0A]/90 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-5xl items-center gap-2 px-4">
        <button
          onClick={onBack}
          aria-label={t('common.back')}
          className="flex h-11 w-11 items-center justify-center rounded-full text-white transition-colors active:bg-[#2C2C2E]"
        >
          <ArrowLeft size={22} className="flip-rtl" />
        </button>
        <h1 className="min-w-0 flex-1 truncate text-center text-base font-semibold text-white">
          {title}
        </h1>
        {onShare ? (
          <button
            onClick={onShare}
            aria-label={t('common.share')}
            className="flex h-11 w-11 items-center justify-center rounded-full text-[#9A9A9E] transition-colors active:bg-[#2C2C2E]"
          >
            <Share size={20} />
          </button>
        ) : (
          <div className="h-11 w-11" />
        )}
        {right}
      </div>
    </header>
  )
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2 className="text-base font-semibold text-white">{children}</h2>
      {action}
    </div>
  )
}

/** skeleton rows for loading catalog/plans */
export function SkeletonRows({ count = 4, tall = false }: { count?: number; tall?: boolean }) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-3" aria-label={t('common.loading')}>
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className={`animate-pulse rounded-[14px] bg-[#1C1C1E] ${tall ? 'h-28' : 'h-[72px]'}`}
        />
      ))}
    </div>
  )
}

export function ErrorState({
  message,
  onRetry,
}: {
  message: string
  onRetry: () => void
}) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col items-center gap-3 rounded-[14px] bg-[#1C1C1E] px-6 py-10 text-center">
      <p className="text-sm text-[#9A9A9E]">{message}</p>
      <button
        onClick={onRetry}
        className="flex min-h-[44px] items-center gap-2 rounded-full bg-[#2C2C2E] px-5 text-sm font-semibold text-white transition-colors active:bg-[#3A3A3C]"
      >
        <RefreshCw size={16} /> {t('common.tryAgain')}
      </button>
      {/* Module 6: no dead ends — every error carries a support contact */}
      <a
        href={`mailto:${CONFIG.supportEmail}?subject=${encodeURIComponent(t('common.appErrorSubject'))}`}
        className="text-xs font-semibold text-[#D7FF3F]"
      >
        {t('common.stillStuck')} {CONFIG.supportEmail}
      </a>
    </div>
  )
}

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: ReactNode
  title: string
  body: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-[14px] bg-[#1C1C1E] px-6 py-12 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#2C2C2E] text-[#9A9A9E]">
        {icon}
      </div>
      <p className="text-base font-semibold text-white">{title}</p>
      <p className="max-w-xs text-sm text-[#9A9A9E]">{body}</p>
      {action}
    </div>
  )
}

/** sticky lime CTA used at the bottom of plan list + checkout */
export function StickyCTA({
  label,
  onClick,
  disabled,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <div className="sticky bottom-0 z-30 border-t border-[#2A2A2C] bg-[#0A0A0A]/95 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur-md">
      <div className="mx-auto max-w-3xl">
        <button
          onClick={onClick}
          disabled={disabled}
          className="min-h-[52px] w-full rounded-2xl bg-[#D7FF3F] text-base font-semibold text-black transition-opacity active:opacity-80 disabled:opacity-30"
        >
          {label}
        </button>
      </div>
    </div>
  )
}
