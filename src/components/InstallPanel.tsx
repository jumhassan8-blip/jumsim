import { useState } from 'react'
import { Check, Copy, MailCheck } from 'lucide-react'
import type { Order } from '../types'
import QrCode from './QrCode'

const STEPS = [
  'Open Settings → Cellular → Add eSIM',
  'Scan this QR code (or paste the activation code)',
  'Select the new line for mobile data when you land',
]

/** QR + manual install path — reused by Installation screen and eSIM detail */
export default function InstallPanel({ order, email }: { order: Order; email: string }) {
  const [copied, setCopied] = useState(false)

  const copyLpa = async () => {
    try {
      await navigator.clipboard.writeText(order.lpaString)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      /* clipboard unavailable */
    }
  }

  return (
    <div className="flex flex-col items-center gap-4 rounded-[14px] bg-[#1C1C1E] p-5">
      <div className="rounded-2xl bg-white p-2">
        <QrCode value={order.lpaString} size={184} />
      </div>

      <button
        onClick={copyLpa}
        className="flex min-h-[44px] items-center gap-2 rounded-full bg-[#2C2C2E] px-4 text-sm font-semibold text-white active:bg-[#3A3A3C]"
      >
        {copied ? <Check size={16} className="text-[#D7FF3F]" /> : <Copy size={16} />}
        {copied ? 'Activation code copied' : 'Copy activation code'}
      </button>

      <ol className="w-full">
        {STEPS.map((s, i) => (
          <li key={i} className="flex gap-3 py-1.5">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#D7FF3F] text-xs font-bold text-black">
              {i + 1}
            </span>
            <span className="text-sm text-[#EBEBF0]">{s}</span>
          </li>
        ))}
      </ol>

      <p className="flex items-center gap-1.5 text-xs text-[#9A9A9E]">
        <MailCheck size={14} className="text-[#D7FF3F]" />
        Instructions sent to {email}
      </p>
    </div>
  )
}
