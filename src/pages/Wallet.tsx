import { useMemo } from 'react'
import { useNavigate } from 'react-router'
import { PhoneCall, Wallet as WalletIcon, Clock } from 'lucide-react'
import { useStore } from '../state/StoreContext'
import { PACKS, callRateExpiry, minutesFor } from '../lib/wallet'
import { formatUSD } from '../lib/money'
import { FlowHeader, EmptyState } from '../components/ui-bits'

const DEFAULT_MOBILE_RATE = 0.08

export default function Wallet() {
  const navigate = useNavigate()
  const { wallet, buyCreditPack, toast } = useStore()

  const expiry = callRateExpiry(wallet.lastTopUpAt)
  const minsAtDefault = minutesFor(wallet.balance, DEFAULT_MOBILE_RATE)

  const txns = useMemo(() => [...wallet.txns].reverse().slice(0, 30), [wallet.txns])

  return (
    <div className="flex min-h-dvh flex-col bg-[#0A0A0A]">
      <FlowHeader title="Call credit" onBack={() => navigate('/profile')} />

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pt-4">
        {/* balance */}
        <section className="mb-4 rounded-[14px] bg-[#1C1C1E] p-5">
          <div className="flex items-center gap-2 text-[#9A9A9E]">
            <WalletIcon size={16} />
            <span className="text-xs font-semibold uppercase tracking-wide">Balance</span>
          </div>
          <p className="mt-1 text-4xl font-semibold text-[#D7FF3F]">
            {formatUSD(wallet.balance)}
          </p>
          <p className="mt-1 flex items-center gap-1.5 text-xs text-[#9A9A9E]">
            <Clock size={12} />
            {expiry
              ? `Credit expires ${new Date(expiry).toLocaleDateString()} (12 months after last top-up)`
              : 'Top up to start calling'}
            {minsAtDefault > 0 && ` · ~${minsAtDefault} min to mobiles at ${formatUSD(DEFAULT_MOBILE_RATE)}/min`}
          </p>
        </section>

        {/* packs */}
        <section className="mb-6">
          <h2 className="mb-2 px-1 text-sm font-semibold text-[#9A9A9E]">Top up packs</h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {PACKS.map((amount) => (
              <button
                key={amount}
                onClick={() => {
                  buyCreditPack(amount)
                  toast(`${formatUSD(amount)} credit added`, 'success')
                }}
                className="flex min-h-[84px] flex-col items-center justify-center gap-1 rounded-[14px] bg-[#1C1C1E] transition-colors active:bg-[#2C2C2E]"
              >
                <span className="text-xl font-semibold text-white">
                  {formatUSD(amount)}
                </span>
                <span className="text-[10px] text-[#9A9A9E]">
                  ~{minutesFor(amount, DEFAULT_MOBILE_RATE)} min to mobiles
                </span>
              </button>
            ))}
          </div>
          <p className="mt-2 px-1 text-[11px] text-[#6E6E73]">
            Charged via your saved payment method.
          </p>
        </section>

        {/* history */}
        <section>
          <h2 className="mb-2 px-1 text-sm font-semibold text-[#9A9A9E]">
            Call & credit history
          </h2>
          {txns.length === 0 ? (
            <EmptyState
              icon={<PhoneCall size={24} />}
              title="No activity yet"
              body="Your packs and calls will appear here with per-second costs deducted."
            />
          ) : (
            <div className="flex flex-col gap-2">
              {txns.map((t) => (
                <div
                  key={t.id}
                  className="flex items-center gap-3 rounded-[14px] bg-[#1C1C1E] px-4 py-3"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-white">
                      {t.note}
                    </span>
                    <span className="block text-xs text-[#6E6E73]">
                      {new Date(t.at).toLocaleString()}
                    </span>
                  </span>
                  <span
                    className={`text-sm font-semibold ${
                      t.amount >= 0 ? 'text-[#D7FF3F]' : 'text-white'
                    }`}
                  >
                    {t.amount >= 0 ? '+' : ''}
                    {formatUSD(t.amount)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  )
}
