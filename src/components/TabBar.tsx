import { useEffect, useState } from 'react'
import { House, Globe, Phone, UserRound } from 'lucide-react'
import { NavLink } from 'react-router'
import { useTranslation } from 'react-i18next'
import { CONFIG } from '../config'
import { getCachedBalance, refreshCallBalance, subscribeBalance } from '../lib/calls'

export default function TabBar() {
  const { t } = useTranslation()
  // badge dot: credit below 60s at the selected destination's rate
  const [lowCredit, setLowCredit] = useState<boolean>(() => {
    const s = getCachedBalance()
    return s.secondsAtRate !== null && s.secondsAtRate < CONFIG.calls.minStartSeconds
  })

  useEffect(() => {
    // fetch the server balance once at shell mount so the dot is right
    // on every screen (the Calls tab re-publishes with its own rate)
    void refreshCallBalance()
    return subscribeBalance((s) => {
      setLowCredit(s.secondsAtRate !== null && s.secondsAtRate < CONFIG.calls.minStartSeconds)
    })
  }, [])

  const TABS = [
    { to: '/', label: t('tab.home'), icon: House, end: true },
    { to: '/explore', label: t('tab.explore'), icon: Globe, end: false },
    ...(CONFIG.calls.enabled
      ? [{ to: '/calls', label: t('tab.calls'), icon: Phone, end: false } as const]
      : []),
    { to: '/profile', label: t('tab.profile'), icon: UserRound, end: false },
  ] as const

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-50 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
    >
      <div className="mx-auto flex max-w-md items-stretch justify-between rounded-3xl border border-[#2C2C2E] bg-[#1C1C1E]/95 px-2 py-1.5 shadow-2xl backdrop-blur-xl">
        {TABS.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `relative flex min-h-[44px] min-w-[60px] flex-1 flex-col items-center justify-center gap-0.5 rounded-2xl text-[10px] font-semibold transition-colors ${
                isActive
                  ? 'bg-[#D7FF3F] text-black'
                  : 'text-[#9A9A9E] active:bg-[#2C2C2E]'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <span className="relative">
                  <Icon size={20} strokeWidth={isActive ? 2.4 : 2} />
                  {to === '/calls' && lowCredit && (
                    <span
                      aria-label={t('tab.lowCredit')}
                      className="absolute -right-1.5 -top-1 h-2.5 w-2.5 rounded-full bg-[#FF453A] ring-2 ring-[#1C1C1E]"
                    />
                  )}
                </span>
                {label}
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
