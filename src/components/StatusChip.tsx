import type { EsimStatus } from '../types'

const META: Record<EsimStatus, { label: string; cls: string }> = {
  not_installed: { label: 'Not installed', cls: 'bg-[#3A3A3C] text-[#9A9A9E]' },
  active: { label: 'Active', cls: 'bg-[#D7FF3F] text-black' },
  expired: { label: 'Expired', cls: 'bg-[#FF453A]/15 text-[#FF6961]' },
  refunded: { label: 'Refunded', cls: 'border border-[#3A3A3C] text-[#6E6E73]' },
}

export default function StatusChip({ status }: { status: EsimStatus }) {
  const m = META[status]
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${m.cls}`}
    >
      {m.label}
    </span>
  )
}
