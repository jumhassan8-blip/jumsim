import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { Country, Plan, Purchase, Order, RentedNumber, AvailableNumber } from '../types'
import { provider } from '../providers'
import { loadPurchases, savePurchases, PURCHASES_CHANGED_EVENT } from '../lib/storage'
import { loadWallet, saveWallet, type WalletState } from '../lib/wallet'
import { loadNumber, saveNumber, graceDeadline } from '../lib/number'
import { loadPricing } from '../data/pricing'
import { numberProvider } from '../providers/number'
import { track } from '../lib/analytics'
import { cacheCatalog, readCachedCatalog } from '../lib/offline'
import { CONFIG } from '../config'
import { authBackend } from '../lib/auth'
import { checkoutConfigured, openStoreCredit } from '../lib/checkout-link'
import { useAuth } from './AuthContext'

type CatalogStatus = 'loading' | 'ready' | 'error'

export interface ToastMsg {
  id: number
  text: string
  kind: 'success' | 'error' | 'info'
}

interface StoreValue {
  catalog: Country[]
  catalogStatus: CatalogStatus
  reloadCatalog: () => void
  purchases: Purchase[]
  countryBySlug: (slug: string) => Country | undefined
  /** record a completed order as a new purchase */
  addPurchase: (order: Order, plan: Plan, country: Country) => void
  markInstalled: (orderId: string) => void
  /** the server confirmed a user-requested refund (POST /api/refund/execute) — sync local state */
  markServerRefunded: (orderId: string) => void
  wallet: WalletState
  buyCreditPack: (amount: number) => void
  /** deduct a finished call; returns false if balance ran dry mid-call */
  settleCall: (cost: number, note: string) => boolean
  /** the user's active rented number, if any (MVP: one at a time) */
  rentedNumber: RentedNumber | null
  /** rent a number; releases any previously rented number first (MVP rule) */
  rentNumber: (pick: AvailableNumber, countryIso: string, countryName: string) => Promise<RentedNumber>
  /** verify the SMS PIN; marks the number active on success */
  verifyRentedNumber: (sid: string, code: string) => Promise<boolean>
  releaseNumber: (sid: string) => Promise<void>
  renewNumber: (sid: string) => Promise<void>
  toasts: ToastMsg[]
  toast: (text: string, kind?: ToastMsg['kind']) => void
}

const StoreContext = createContext<StoreValue | null>(null)

let toastSeq = 0

export function StoreProvider({ children }: { children: ReactNode }) {
  const [catalog, setCatalog] = useState<Country[]>([])
  const [catalogStatus, setCatalogStatus] = useState<CatalogStatus>('loading')
  const [purchases, setPurchases] = useState<Purchase[]>(() => loadPurchases())
  const [wallet, setWallet] = useState<WalletState>(() => loadWallet())
  const [rentedNumber, setRentedNumber] = useState<RentedNumber | null>(() => loadNumber())
  const [toasts, setToasts] = useState<ToastMsg[]>([])
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  // Cloud resync (login on a new device, anonymous linking) writes the cache
  // from outside this context — re-read it so orders appear without a reload.
  useEffect(() => {
    const onChanged = () => setPurchases(loadPurchases())
    window.addEventListener(PURCHASES_CHANGED_EVENT, onChanged)
    return () => window.removeEventListener(PURCHASES_CHANGED_EVENT, onChanged)
  }, [])

  const toast = useCallback((text: string, kind: ToastMsg['kind'] = 'info') => {
    const id = ++toastSeq
    setToasts((prev) => [...prev.slice(-2), { id, text, kind }])
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, 3600)
  }, [])

  const reloadCatalog = useCallback(() => {
    setCatalogStatus('loading')
    provider
      .getCatalog()
      .then((c) => {
        if (!mounted.current) return
        const visible = CONFIG.disabledCountries.length
          ? c.filter((country) => !CONFIG.disabledCountries.includes(country.iso2))
          : c
        setCatalog(visible)
        cacheCatalog(visible)
        setCatalogStatus('ready')
      })
      .catch(() => {
        if (!mounted.current) return
        // OFFLINE MODE: fall back to the 24h catalog cache; purchased eSIMs
        // are stored locally and always visible either way.
        const cached = readCachedCatalog()
        if (cached) {
          setCatalog(cached)
          setCatalogStatus('ready')
          toast('Offline — showing cached destinations', 'info')
        } else {
          setCatalogStatus('error')
        }
      })
  }, [toast])

  useEffect(() => {
    reloadCatalog()
  }, [reloadCatalog])

  // Module 5 — rental lifecycle: active → grace after renewsAt, released after grace
  useEffect(() => {
    let cancelled = false
    const tick = async () => {
      if (cancelled) return
      const n = loadNumber()
      if (!n || n.status === 'released') return
      let graceDays = 3
      try {
        graceDays = (await loadPricing()).numberRental.gracePeriodDays
      } catch {
        /* default */
      }
      const t = Date.now()
      if (n.status === 'active' && t > n.renewsAt) {
        const next: RentedNumber = { ...n, status: 'grace' }
        setRentedNumber(next)
        saveNumber(next)
        toast('Your number rental expired — renew within ' + graceDays + ' days to keep it', 'info')
      } else if (n.status === 'grace' && t > graceDeadline(n, graceDays)) {
        await numberProvider.releaseNumber(n.sid)
        saveNumber(null)
        setRentedNumber(null)
        track('number_released', { reason: 'expired', sid: n.sid })
        toast('Your number was released back to inventory', 'info')
      }
    }
    void tick()
    const t = window.setInterval(() => void tick(), 60_000)
    return () => {
      cancelled = true
      window.clearInterval(t)
    }
  }, [toast])

  const countryBySlug = useCallback(
    (slug: string) => catalog.find((c) => c.slug === slug),
    [catalog],
  )

  const { session: authSession } = useAuth()
  const authUidRef = useRef<string | null>(null)
  authUidRef.current = authSession.account?.uid ?? null

  const persist = useCallback((next: Purchase[]) => {
    setPurchases(next)
    savePurchases(next)
    // Module 16 — dual-write: the local cache stays the offline-first source
    // for the UI, while the cloud doc (Firestore: users/{uid}/orders/{id})
    // is the cross-device source of truth. Best-effort: a failed write never
    // blocks a purchase; the next login resyncs from the local copy.
    const uid = authUidRef.current
    if (uid) {
      for (const p of next) {
        void authBackend
          .putOrder(uid, {
            orderId: p.order.id,
            uid,
            email: p.order.email,
            purchase: p,
            updatedAt: Date.now(),
          })
          .catch(() => {})
      }
    }
  }, [])

  const addPurchase = useCallback(
    (order: Order, plan: Plan, country: Country) => {
      const purchase: Purchase = {
        order,
        plan,
        country,
        status: 'not_installed',
        installedAt: null,
      }
      persist([...loadPurchases(), purchase])
      track(order.topUpFor ? 'topup' : 'purchase', {
        planId: plan.id,
        price: plan.wholesaleUSD,
        iccid: order.iccid,
      })
    },
    [persist],
  )

  const markInstalled = useCallback(
    (orderId: string) => {
      const current = loadPurchases()
      const next = current.map((p) =>
        p.order.id === orderId
          ? { ...p, status: 'active' as const, installedAt: Date.now() }
          : p,
      )
      persist(next)
      track('install_completed', { orderId })
    },
    [persist],
  )

  // Server confirmed a user-requested refund (POST /api/refund/execute
  // succeeded — the eSIM was terminated at the supplier BEFORE money moved).
  // Flip the local card; the authoritative state stays server-side.
  const markServerRefunded = useCallback(
    (orderId: string) => {
      const current = loadPurchases()
      const target = current.find((p) => p.order.id === orderId)
      if (!target || target.status === 'refunded') return
      persist(
        current.map((p) =>
          p.order.id === orderId ? { ...p, status: 'refunded' as const } : p,
        ),
      )
      track('refund_executed', { orderId })
    },
    [persist],
  )

  // Store compliance: the app NEVER charges for call credit. "Buying" a pack
  // opens jumesim.com/calls/topup in the external browser; credit appears
  // via the server (call balance is server-computed) after payment there.
  const buyCreditPack = useCallback((amount: number) => {
    if (!checkoutConfigured) return // CTA surfaces render "Store opening soon" instead
    track('topup_linkout_tapped', { kind: 'call_credit', amount })
    openStoreCredit()
  }, [])

  const settleCall = useCallback(
    (cost: number, note: string) => {
      const current = loadWallet()
      const affordable = Math.min(cost, current.balance)
      const next: WalletState = {
        balance: Math.round((current.balance - affordable) * 100) / 100,
        lastTopUpAt: current.lastTopUpAt,
        txns: [
          ...current.txns,
          {
            id: `txn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            kind: 'call',
            amount: -affordable,
            at: Date.now(),
            note,
          },
        ],
      }
      setWallet(next)
      saveWallet(next)
      return affordable >= cost - 0.005
    },
    [],
  )

  const rentNumber = useCallback(
    async (pick: AvailableNumber, countryIso: string, countryName: string) => {
      const existing = loadNumber()
      if (existing && existing.status !== 'released') {
        await numberProvider.releaseNumber(existing.sid)
        track('number_released', { reason: 'switched', sid: existing.sid })
      }
      const email = localStorage.getItem('jum-esim:last-email') ?? ''
      const rented = await numberProvider.rentNumber(pick, email)
      rented.countryIso = countryIso
      rented.countryName = countryName
      setRentedNumber(rented)
      saveNumber(rented)
      track('number_selected', { country: countryIso, sid: rented.sid })
      return rented
    },
    [],
  )

  const verifyRentedNumber = useCallback(
    async (sid: string, code: string) => {
      const ok = await numberProvider.verifyNumber(sid, code)
      if (ok) {
        const current = loadNumber()
        if (current && current.sid === sid) {
          const next: RentedNumber = { ...current, verified: true, status: 'active' }
          setRentedNumber(next)
          saveNumber(next)
        }
      }
      return ok
    },
    [],
  )

  const releaseNumber = useCallback(
    async (sid: string) => {
      await numberProvider.releaseNumber(sid)
      saveNumber(null)
      setRentedNumber(null)
      track('number_released', { reason: 'user', sid })
    },
    [],
  )

  const renewNumber = useCallback(
    async (sid: string) => {
      await numberProvider.renewNumber(sid)
      const current = loadNumber()
      if (current && current.sid === sid) {
        const next: RentedNumber = {
          ...current,
          status: 'active',
          renewsAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
        }
        setRentedNumber(next)
        saveNumber(next)
      }
      track('rental_renewed', { sid })
    },
    [],
  )

  const value = useMemo<StoreValue>(
    () => ({
      catalog,
      catalogStatus,
      reloadCatalog,
      purchases,
      countryBySlug,
      addPurchase,
      markInstalled,
      markServerRefunded,
      wallet,
      buyCreditPack,
      settleCall,
      rentedNumber,
      rentNumber,
      verifyRentedNumber,
      releaseNumber,
      renewNumber,
      toasts,
      toast,
    }),
    [
      catalog,
      catalogStatus,
      reloadCatalog,
      purchases,
      countryBySlug,
      addPurchase,
      markInstalled,
      markServerRefunded,
      wallet,
      buyCreditPack,
      settleCall,
      rentedNumber,
      rentNumber,
      verifyRentedNumber,
      releaseNumber,
      renewNumber,
      toasts,
      toast,
    ],
  )

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useStore must be used inside StoreProvider')
  return ctx
}

const toastStyles: Record<ToastMsg['kind'], string> = {
  success: 'bg-[#D7FF3F] text-black',
  error: 'bg-[#FF453A] text-white',
  info: 'bg-[#2C2C2E] text-white border border-[#3A3A3C]',
}

export function ToastViewport() {
  const { toasts } = useStore()
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-24 z-[70] flex flex-col items-center gap-2 px-4"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`max-w-sm rounded-2xl px-4 py-3 text-sm font-semibold shadow-lg ${toastStyles[t.kind]}`}
        >
          {t.text}
        </div>
      ))}
    </div>
  )
}
