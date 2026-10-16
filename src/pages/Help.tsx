import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import {
  ChevronDown,
  ChevronRight,
  FileText,
  LifeBuoy,
  Mail,
  RotateCcw,
  ShieldCheck,
} from 'lucide-react'
import { CONFIG } from '../config'
import { FlowHeader } from '../components/ui-bits'

interface Faq {
  q: string
  a: string
}

/** top 10 support issues */
const FAQS: Faq[] = [
  {
    q: 'My eSIM won’t install',
    a: 'Check you’re on a stable Wi-Fi connection and that the QR code / LPA string is entered exactly as shown. On Android: Settings → Network → SIM manager → Add eSIM. On iPhone: Settings → Cellular → Add eSIM. If install still fails within the activation window, contact support for a free reissue or refund.',
  },
  {
    q: 'No signal after installing',
    a: 'Make sure the Jum eSIM line is turned ON, Data Roaming is enabled for that line, and the eSIM is selected as your mobile-data line. Toggle airplane mode off and on. If the country has multiple networks, your phone usually picks the best automatically.',
  },
  {
    q: 'APN settings',
    a: 'Most eSIMs configure the APN automatically. If data doesn’t connect, check Settings → Mobile Data → Jum eSIM → APN and set it to the value shown on your install screen. Save, restart, and data should connect.',
  },
  {
    q: 'How do refunds work?',
    a: 'If your eSIM fails to activate and you report it within the activation window, we cancel the eSIM with our provider and refund the full amount to your original payment method. Refund policy: ' +
      CONFIG.legal.refunds,
  },
  {
    q: 'Hotspot / tethering not working',
    a: 'Hotspot is supported on all Jum data plans. Enable Personal Hotspot (iPhone) or Mobile Hotspot (Android) with the Jum eSIM selected as the data line. Some phones require hotspot APN — set it the same as your data APN.',
  },
  {
    q: 'How do I top up my eSIM?',
    a: 'Open My eSIMs, pick the eSIM, and choose a top-up plan. Top-ups apply instantly to the installed eSIM — no new QR code needed.',
  },
  {
    q: 'How do call credit and my number work?',
    a: 'Call credit is drawn per second at each country’s rate and is valid 12 months from your last top-up. Rent a number once and it becomes your caller ID for calls made through the Jum app.',
  },
  {
    q: 'Can I use the eSIM in multiple countries?',
    a: 'Country plans work only in the purchased country. Regional and global bundles cover multiple destinations on one eSIM — check the country list on the plan before buying.',
  },
  {
    q: 'When does my plan start?',
    a: 'The validity clock starts when the eSIM first connects to a supported network at your destination — not at purchase. Install any time before you travel.',
  },
  {
    q: 'I was charged but didn’t get my eSIM',
    a: 'This is rare, but if it happens you are never charged twice: check My eSIMs in a few minutes — orders reconcile automatically. Still missing? Email support with your order ID and we’ll fix it or refund immediately.',
  },
]

export default function Help() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const orderId = params.get('orderId')
  const [open, setOpen] = useState<number | null>(null)

  /** chat screen handles the email-app fallback itself — this row never dead-ends */
  const openChat = () => {
    navigate(orderId ? `/support/chat?orderId=${encodeURIComponent(orderId)}` : '/support/chat')
  }

  const links = [
    { label: 'Privacy Policy', doc: 'privacy', icon: ShieldCheck },
    { label: 'Terms of Service', doc: 'terms', icon: FileText },
    { label: 'Refund Policy', doc: 'refund', icon: RotateCcw },
  ] as const

  return (
    <div className="flex min-h-dvh flex-col bg-[#0A0A0A]">
      <FlowHeader title="Help" onBack={() => navigate(-1)} />

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pt-4">
        {/* WhatsApp support lives on the Profile screen (next to this Help
            row), NOT here — this screen is email + FAQ + legal only. */}
        <button
          onClick={openChat}
          className="mb-4 flex min-h-[56px] w-full items-center gap-3 rounded-[14px] bg-[#1C1C1E] p-4 text-left"
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#D7FF3F]/10">
            <Mail size={18} className="text-[#D7FF3F]" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-white">Contact support</span>
            <span className="block text-xs text-[#9A9A9E]">
              {CONFIG.supportEmail}
              {orderId ? ` · order ${orderId} pre-filled` : ' · replies within 24h'}
            </span>
          </span>
          <ChevronRight size={18} className="text-[#9A9A9E]" />
        </button>

        <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-[#9A9A9E]">
          <LifeBuoy size={12} /> Frequently asked questions
        </p>
        <div className="flex flex-col gap-2 pb-6">
          {FAQS.map((f, i) => (
            <div key={i} className="rounded-[14px] bg-[#1C1C1E]">
              <button
                onClick={() => setOpen(open === i ? null : i)}
                aria-expanded={open === i}
                className="flex min-h-[48px] w-full items-center justify-between gap-3 p-4 text-left"
              >
                <span className="text-sm font-semibold text-white">{f.q}</span>
                <ChevronDown
                  size={16}
                  className={`shrink-0 text-[#9A9A9E] transition-transform ${
                    open === i ? 'rotate-180' : ''
                  }`}
                />
              </button>
              {open === i && (
                <p className="px-4 pb-4 text-sm leading-relaxed text-[#9A9A9E]">{f.a}</p>
              )}
            </div>
          ))}
        </div>

        <p className="mb-2 text-xs font-semibold text-[#9A9A9E]">Legal</p>
        <div className="mb-10 flex flex-col gap-2">
          {links.map(({ label, doc, icon: Icon }) => (
            <button
              key={label}
              onClick={() => navigate(`/legal/${doc}`)}
              className="flex min-h-[48px] items-center gap-3 rounded-[14px] bg-[#1C1C1E] p-4 text-left"
            >
              <Icon size={16} className="text-[#9A9A9E]" />
              <span className="flex-1 text-sm font-semibold text-white">{label}</span>
              <ChevronRight size={16} className="text-[#9A9A9E]" />
            </button>
          ))}
        </div>
      </main>
    </div>
  )
}
