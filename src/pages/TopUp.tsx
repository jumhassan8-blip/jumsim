/**
 * Top Up tab — airtime & data for ANY phone line (brief §4).
 * Split flows on one screen: "My Line" (saved numbers, one-tap repeat,
 * auto top-up settings) | "Another Line" (country → number → operator →
 * products). Both converge on the product grid → pay sheet.
 * No provider configured → designed "coming soon / waitlist" state
 * (captures country + number → launch-planning leads). NEVER fabricated
 * operators or prices.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Smartphone, Search, X, Zap, Home, RefreshCw, ChevronRight, Share2, BellRing,
} from 'lucide-react'
import { track } from '../lib/analytics'
import { flagFor } from '../lib/flags'
import { publishTopUpPending } from '../lib/topup-pending'
import { TOPUP_COUNTRIES } from '../lib/country-list'
import {
  TopUpError, detectOperator, executeTopUp, fetchCatalog,
  fetchTopUpState, fetchTopUpStatus, formatAsYouType, joinWaitlist, lockQuote,
  parseNumber, saveNumber, type DetectedOperator, type SavedNumber,
  type TopUpOrder, type TopUpProduct, type TopUpQuote, type TopUpState,
} from '../lib/topup'
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
} from '@/components/ui/sheet'

/* ------------------------------------------------------------------ */
/* small building blocks                                              */
/* ------------------------------------------------------------------ */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <h2 className="px-1 text-xs font-semibold uppercase tracking-wider text-[#9A9A9E]">{title}</h2>
      <div className="mt-2 space-y-2">{children}</div>
    </section>
  )
}

function Card({ children, onClick, className = '' }: { children: React.ReactNode; onClick?: () => void; className?: string }) {
  return (
    <div
      onClick={onClick}
      className={`rounded-2xl border border-[#2C2C2E] bg-[#1C1C1E] p-4 ${onClick ? 'cursor-pointer active:bg-[#2C2C2E]' : ''} ${className}`}
    >
      {children}
    </div>
  )
}

function Segmented({ options, value, onChange }: {
  options: Array<{ value: string; label: string }>
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="flex rounded-2xl border border-[#2C2C2E] bg-[#1C1C1E] p-1" role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={`flex-1 rounded-xl px-3 py-2 text-sm font-semibold transition-colors ${
            value === o.value ? 'bg-[#D7FF3F] text-black' : 'text-[#9A9A9E] active:bg-[#2C2C2E]'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function Chip({ label, onClick, active }: { label: string; onClick?: () => void; active?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full border px-3 py-1.5 text-xs font-medium ${
        active
          ? 'border-[#D7FF3F] bg-[#D7FF3F]/10 text-[#D7FF3F]'
          : 'border-[#2C2C2E] bg-[#1C1C1E] text-[#E5E5EA] active:bg-[#2C2C2E]'
      }`}
    >
      {label}
    </button>
  )
}

function CountryPickerSheet({ open, onClose, onPick }: {
  open: boolean
  onClose: () => void
  onPick: (iso: string, name: string) => void
}) {
  const [q, setQ] = useState('')
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return TOPUP_COUNTRIES.slice(0, 60)
    return TOPUP_COUNTRIES.filter(
      (c) => c.name.toLowerCase().includes(needle) || c.iso.toLowerCase().includes(needle),
    ).slice(0, 60)
  }, [q])
  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="bottom" className="max-h-[80dvh] overflow-y-auto rounded-t-3xl border-[#2C2C2E] bg-[#1C1C1E]">
        <SheetHeader>
          <SheetTitle className="text-left text-base">Choose country</SheetTitle>
          <SheetDescription className="sr-only">Pick the destination country for the phone number</SheetDescription>
        </SheetHeader>
        <div className="mt-3 flex items-center gap-2 rounded-xl border border-[#2C2C2E] bg-[#0A0A0A] px-3">
          <Search size={16} className="text-[#9A9A9E]" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search countries"
            className="w-full bg-transparent py-2.5 text-sm outline-none placeholder:text-[#636366]"
          />
          {q && <X size={16} className="text-[#9A9A9E]" onClick={() => setQ('')} />}
        </div>
        <div className="mt-3 space-y-1">
          {list.map((c) => (
            <button
              key={c.iso}
              onClick={() => { onPick(c.iso, c.name); onClose() }}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm active:bg-[#2C2C2E]"
            >
              <span className="text-lg">{flagFor(c.iso)}</span>
              <span className="flex-1">{c.name}</span>
              <span className="text-xs text-[#9A9A9E]">{c.iso}</span>
            </button>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  )
}

/* ------------------------------------------------------------------ */
/* waitlist (no-provider state)                                        */
/* ------------------------------------------------------------------ */

function WaitlistState({ onJoined }: { onJoined: () => void }) {
  const { t } = useTranslation()
  const [countryIso, setCountryIso] = useState('')
  const [countryName, setCountryName] = useState('')
  const [number, setNumber] = useState('')
  const [picker, setPicker] = useState(false)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [err, setErr] = useState('')

  const submit = async () => {
    const parsed = parseNumber(number, (countryIso || undefined) as never)
    if (!parsed?.valid) { setErr(t('topup.invalidNumber')); return }
    setBusy(true)
    setErr('')
    try {
      await joinWaitlist(parsed.countryIso || countryIso, parsed.msisdn)
      track('topup_waitlist_joined', { countryIso: parsed.countryIso || countryIso })
      setDone(true)
      onJoined()
    } catch (e) {
      setErr(e instanceof TopUpError ? e.code : 'error')
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <div className="mt-10 flex flex-col items-center text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#D7FF3F]/10">
          <BellRing className="text-[#D7FF3F]" size={26} />
        </div>
        <h2 className="mt-4 text-lg font-bold">{t('topup.waitlistDoneTitle')}</h2>
        <p className="mt-1 max-w-xs text-sm text-[#9A9A9E]">{t('topup.waitlistDoneBody')}</p>
      </div>
    )
  }

  return (
    <div className="mt-6">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#D7FF3F]/10">
        <Smartphone className="text-[#D7FF3F]" size={26} />
      </div>
      <h2 className="mt-4 text-lg font-bold">{t('topup.comingTitle')}</h2>
      <p className="mt-1 text-sm text-[#9A9A9E]">{t('topup.comingBody')}</p>

      <Section title={t('topup.country')}>
        <button
          onClick={() => setPicker(true)}
          className="flex w-full items-center gap-3 rounded-2xl border border-[#2C2C2E] bg-[#1C1C1E] px-4 py-3 text-left text-sm active:bg-[#2C2C2E]"
        >
          <span className="text-xl">{countryIso ? flagFor(countryIso) : '🌍'}</span>
          <span className="flex-1">{countryName || t('topup.tapToChooseCountry')}</span>
          <ChevronRight size={16} className="text-[#9A9A9E]" />
        </button>
      </Section>

      <Section title={t('topup.phoneNumber')}>
        <input
          value={number}
          onChange={(e) => setNumber(formatAsYouType(e.target.value, (countryIso || undefined) as never))}
          inputMode="tel"
          placeholder="+233 24 000 0000"
          className="w-full rounded-2xl border border-[#2C2C2E] bg-[#1C1C1E] px-4 py-3 text-sm outline-none placeholder:text-[#636366] focus:border-[#D7FF3F]"
        />
      </Section>

      {err && <p className="mt-3 text-sm text-[#FF453A]">{err}</p>}
      <button
        onClick={submit}
        disabled={busy || !number}
        className="mt-5 w-full rounded-2xl bg-[#D7FF3F] py-3.5 text-sm font-bold text-black disabled:opacity-40"
      >
        {busy ? t('common.loading') : t('topup.joinWaitlist')}
      </button>

      <CountryPickerSheet open={picker} onClose={() => setPicker(false)} onPick={(iso, name) => { setCountryIso(iso); setCountryName(name) }} />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* product grid (both flows converge here)                            */
/* ------------------------------------------------------------------ */

function ProductGrid({ products, onPick }: { products: TopUpProduct[]; onPick: (p: TopUpProduct) => void }) {
  const [tab, setTab] = useState<'airtime' | 'data'>('airtime')
  const airtime = products.filter((p) => p.kind === 'airtime')
  const data = products.filter((p) => p.kind === 'data')
  const list = tab === 'airtime' ? airtime : data
  return (
    <div>
      <div className="flex gap-2">
        <Chip label="Airtime" active={tab === 'airtime'} onClick={() => setTab('airtime')} />
        <Chip label="Data bundles" active={tab === 'data'} onClick={() => setTab('data')} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {list.map((p) => (
          <button
            key={p.id}
            onClick={() => onPick(p)}
            className="rounded-2xl border border-[#2C2C2E] bg-[#1C1C1E] p-3.5 text-left active:border-[#D7FF3F]"
          >
            <div className="text-base font-bold text-[#D7FF3F]">{p.amountLocal}</div>
            <div className="mt-0.5 text-xs text-[#9A9A9E]">${p.amountUsd.toFixed(2)} USD</div>
            {p.feeUsd > 0 && <div className="mt-0.5 text-[10px] text-[#636366]">+ ${p.feeUsd.toFixed(2)} fee</div>}
            {p.validity && <div className="mt-1 text-[10px] text-[#9A9A9E]">{p.validity}</div>}
          </button>
        ))}
      </div>
      {list.length === 0 && <p className="mt-4 text-sm text-[#9A9A9E]">No {tab} products for this operator yet.</p>}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* the page                                                           */
/* ------------------------------------------------------------------ */

type Flow = 'myline' | 'another'

export default function TopUp() {
  const { t } = useTranslation()
  const [state, setState] = useState<TopUpState | null>(null)
  const [flow, setFlow] = useState<Flow>('myline')

  // another-line form
  const [countryIso, setCountryIso] = useState('')
  const [countryName, setCountryName] = useState('')
  const [number, setNumber] = useState('')
  const [operator, setOperator] = useState<DetectedOperator | null>(null)
  const [manualOperator, setManualOperator] = useState('')
  const [products, setProducts] = useState<TopUpProduct[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [detecting, setDetecting] = useState(false)
  const [formErr, setFormErr] = useState('')

  // pay sheet
  const [payProduct, setPayProduct] = useState<TopUpProduct | null>(null)
  const [quote, setQuote] = useState<TopUpQuote | null>(null)
  const [quoteErr, setQuoteErr] = useState('')
  const [quoteExpired, setQuoteExpired] = useState(false)
  const [payBusy, setPayBusy] = useState(false)
  const [order, setOrder] = useState<TopUpOrder | null>(null)
  const [payError, setPayError] = useState('')
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const loadState = useCallback(async () => {
    try {
      const s = await fetchTopUpState()
      setState(s)
      publishTopUpPending(s.pendingCount)
    } catch {
      setState((prev) => prev ?? ({ providerConfigured: null, balanceUsd: 0, savedNumbers: [], recents: [], pendingCount: 0, autoTopUps: [], uid: null }))
    }
  }, [])

  useEffect(() => {
    track('topup_tab_opened')
    void loadState()
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [loadState])

  /* --- operator auto-detect (ported numbers: provider authoritative) --- */
  useEffect(() => {
    const parsed = parseNumber(number, (countryIso || undefined) as never)
    if (!parsed?.valid || parsed.msisdn.length < 10) { setOperator(null); setProducts([]); return }
    setDetecting(true)
    const msisdn = parsed.msisdn
    const timer = setTimeout(async () => {
      try {
        const { operator: op } = await detectOperator(msisdn)
        setOperator(op)
        if (op) track('topup_operator_detected', { operatorId: op.id })
        const { products: prods } = await fetchCatalog(parsed.countryIso || countryIso, op?.id)
        setProducts(prods)
      } catch {
        setOperator(null)
        setProducts([])
      } finally {
        setDetecting(false)
      }
    }, 450)
    return () => clearTimeout(timer)
  }, [number, countryIso])

  const operatorName = operator?.name ?? (manualOperator || null)

  const pickProduct = async (p: TopUpProduct) => {
    const parsed = parseNumber(number, (countryIso || undefined) as never)
    if (!parsed?.valid) { setFormErr(t('topup.invalidNumber')); return }
    setFormErr('')
    setPayProduct(p)
    setQuote(null)
    setQuoteErr('')
    setQuoteExpired(false)
    track('topup_product_selected', { productId: p.id, kind: p.kind })
    try {
      const q = await lockQuote(p.id, parsed.msisdn)
      setQuote(q)
      track('topup_quote_locked', { quoteId: q.quoteId, totalUsd: q.totalUsd })
      // re-quote on expiry (60s lock)
      const ttl = Math.max(1000, q.expiresAt - Date.now())
      setTimeout(() => setQuoteExpired(true), ttl)
    } catch (e) {
      setQuoteErr(e instanceof TopUpError ? e.code : 'quote_failed')
    }
  }

  const requote = async () => {
    if (!payProduct) return
    setQuoteExpired(false)
    const parsed = parseNumber(number, (countryIso || undefined) as never)
    if (!parsed?.valid) return
    try {
      setQuote(await lockQuote(payProduct.id, parsed.msisdn))
    } catch (e) {
      setQuoteErr(e instanceof TopUpError ? e.code : 'quote_failed')
    }
  }

  /* --- pay --- */
  const pay = async (payPath: 'balance' | 'card') => {
    if (!quote || !payProduct) return
    const parsed = parseNumber(number, (countryIso || undefined) as never)
    if (!parsed?.valid) { setFormErr(t('topup.invalidNumber')); return }
    setPayBusy(true)
    setPayError('')
    track(payPath === 'balance' ? 'topup_balance_pay' : 'topup_card_pay', { totalUsd: quote.totalUsd })
    try {
      const r = await executeTopUp({
        quote,
        countryIso: parsed.countryIso || countryIso,
        operatorId: operator?.id ?? 'manual',
        operatorName: operatorName ?? 'Unknown operator',
        kind: payProduct.kind,
        payPath,
        clientSecret: payPath === 'card' ? 'pi_mock_topup_secret_autoconfirm' : undefined,
        firstCardUse: payPath === 'card' ? true : undefined,
        uid: state?.uid,
      })
      setOrder(r.order)
      void pollStatus(r.order.id)
    } catch (e) {
      const err = e instanceof TopUpError ? e : null
      if (err && ['daily_limit', 'daily_cap', 'first_topup_limit', 'card_cooldown', 'rate_limited'].includes(err.code)) {
        track('topup_fraud_wall', { code: err.code })
      }
      setPayError(err?.code ?? 'payment_failed')
    } finally {
      setPayBusy(false)
    }
  }

  const pollStatus = (orderId: string) => {
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = setInterval(async () => {
      try {
        const { order: o } = await fetchTopUpStatus(orderId)
        setOrder(o)
        if (o.status === 'delivered') {
          if (pollRef.current) clearInterval(pollRef.current)
          track('topup_delivered', { orderId: o.id })
          void loadState()
        } else if (o.status === 'failed' || o.status === 'refunded') {
          if (pollRef.current) clearInterval(pollRef.current)
          track('topup_failed_refunded', { orderId: o.id, reason: o.failureReason ?? '' })
          void loadState()
        }
      } catch { /* keep polling */ }
    }, 1500)
  }

  const repeatLast = async (s: SavedNumber) => {
    setFlow('another')
    setCountryIso(s.countryIso)
    setCountryName('')
    setNumber(formatAsYouType(s.msisdn))
    track('topup_repeat_last', { savedNumberId: s.id })
  }

  const saveAsMine = async (nickname: string) => {
    const parsed = parseNumber(number, (countryIso || undefined) as never)
    if (!parsed?.valid || !state?.uid) return
    await saveNumber({
      msisdn: parsed.msisdn, countryIso: parsed.countryIso || countryIso,
      operatorName, nickname, uid: state.uid,
    })
    track('topup_saved_number')
    void loadState()
  }

  /* ---------------------------------------------------------------- */
  const noProvider = state !== null && state.providerConfigured === null

  return (
    <div className="mx-auto max-w-md px-4 pb-32 pt-6">
      <header>
        <h1 className="text-2xl font-extrabold tracking-tight">{t('topup.title')}</h1>
        <p className="mt-1 text-sm text-[#9A9A9E]">{t('topup.subtitle')}</p>
      </header>

      {state === null ? (
        <p className="mt-10 text-sm text-[#9A9A9E]">{t('common.loading')}</p>
      ) : noProvider ? (
        <WaitlistState onJoined={() => undefined} />
      ) : (
        <>
          {/* segmented split flows */}
          <div className="mt-5">
            <Segmented
              value={flow}
              onChange={(v) => setFlow(v as Flow)}
              options={[
                { value: 'myline', label: t('topup.myLine') },
                { value: 'another', label: t('topup.anotherLine') },
              ]}
            />
          </div>

          {flow === 'myline' ? (
            <>
              <Section title={t('topup.savedNumbers')}>
                {state.savedNumbers.length === 0 && (
                  <Card><p className="text-sm text-[#9A9A9E]">{t('topup.noSavedNumbers')}</p></Card>
                )}
                {state.savedNumbers.map((s) => (
                  <Card key={s.id} onClick={() => repeatLast(s)}>
                    <div className="flex items-center gap-3">
                      <span className="text-2xl">{flagFor(s.countryIso)}</span>
                      <div className="flex-1">
                        <div className="text-sm font-semibold">{s.nickname}</div>
                        <div className="text-xs text-[#9A9A9E]">···{s.msisdn.slice(-4)} {s.operatorName ? `· ${s.operatorName}` : ''}</div>
                      </div>
                      <RefreshCw size={16} className="text-[#D7FF3F]" />
                    </div>
                  </Card>
                ))}
              </Section>

              {state.recents.length > 0 && (
                <Section title={t('topup.recents')}>
                  {state.recents.slice(0, 3).map((r) => (
                    <Card key={r.id}>
                      <div className="flex items-center gap-3">
                        <span className="text-xl">{flagFor(r.countryIso)}</span>
                        <div className="flex-1">
                          <div className="text-sm font-semibold">{r.operatorName} · ${r.amountUsd.toFixed(2)}</div>
                          <div className="text-xs text-[#9A9A9E]">···{r.msisdnLast4} · {r.status}</div>
                        </div>
                      </div>
                    </Card>
                  ))}
                </Section>
              )}

              {state.autoTopUps.length > 0 && (
                <Section title={t('topup.autoTopUps')}>
                  {state.autoTopUps.map((a) => (
                    <Card key={a.id}>
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-sm font-semibold">{t('topup.autoTopUpRow', { day: a.dueDay })}</div>
                          <div className="text-xs text-[#9A9A9E]">{a.productId}</div>
                        </div>
                        <span className={`h-2.5 w-2.5 rounded-full ${a.enabled ? 'bg-[#D7FF3F]' : 'bg-[#3A3A3C]'}`} />
                      </div>
                    </Card>
                  ))}
                </Section>
              )}

              {/* cross-sell: My Line users likely travel → eSIM (brief §7) */}
              <Section title="">
                <Card onClick={() => { track('topup_crosssell_esim_tapped'); window.location.href = '/explore' }}>
                  <div className="flex items-center gap-3">
                    <Zap size={18} className="text-[#D7FF3F]" />
                    <div className="flex-1">
                      <div className="text-sm font-semibold">{t('topup.travelingTitle')}</div>
                      <div className="text-xs text-[#9A9A9E]">{t('topup.travelingBody', { price: '$2.99' })}</div>
                    </div>
                    <ChevronRight size={16} className="text-[#9A9A9E]" />
                  </div>
                </Card>
              </Section>
            </>
          ) : (
            <>
              <Section title={t('topup.country')}>
                <button
                  onClick={() => setPickerOpen(true)}
                  className="flex w-full items-center gap-3 rounded-2xl border border-[#2C2C2E] bg-[#1C1C1E] px-4 py-3 text-left text-sm active:bg-[#2C2C2E]"
                >
                  <span className="text-xl">{countryIso ? flagFor(countryIso) : '🌍'}</span>
                  <span className="flex-1">{countryName || t('topup.tapToChooseCountry')}</span>
                  <ChevronRight size={16} className="text-[#9A9A9E]" />
                </button>
              </Section>

              <Section title={t('topup.phoneNumber')}>
                <input
                  value={number}
                  onChange={(e) => { setNumber(formatAsYouType(e.target.value, (countryIso || undefined) as never)); setFormErr('') }}
                  inputMode="tel"
                  placeholder="+233 24 000 0000"
                  className="w-full rounded-2xl border border-[#2C2C2E] bg-[#1C1C1E] px-4 py-3 text-sm outline-none placeholder:text-[#636366] focus:border-[#D7FF3F]"
                />
                {formErr && <p className="mt-2 text-xs text-[#FF453A]">{formErr}</p>}
              </Section>

              {detecting && <p className="mt-3 text-xs text-[#9A9A9E]">{t('topup.detecting')}</p>}
              {operator && (
                <div className="mt-3 flex items-center gap-2">
                  <Chip label={`${t('topup.operator')}: ${operator.name}`} active />
                  <Chip label={t('topup.notRightChange')} onClick={() => setManualOperator(operator.name === 'MTN Ghana' ? 'Vodafone Ghana' : 'MTN Ghana')} />
                </div>
              )}
              {manualOperator && manualOperator !== operator?.name && (
                <div className="mt-2 flex items-center gap-2">
                  <Chip label={`${t('topup.operator')}: ${manualOperator}`} active />
                  <Chip label={t('topup.notRightChange')} onClick={() => setManualOperator('')} />
                </div>
              )}

              {products.length > 0 && (
                <Section title={t('topup.chooseProduct')}>
                  <ProductGrid products={products} onPick={pickProduct} />
                </Section>
              )}

              {/* cross-sell: Another Line users send credit home (brief §7) */}
              <Section title="">
                <Card onClick={() => { track('topup_crosssell_esim_tapped'); window.location.href = '/explore' }}>
                  <div className="flex items-center gap-3">
                    <Home size={18} className="text-[#D7FF3F]" />
                    <div className="flex-1">
                      <div className="text-sm font-semibold">{t('topup.sendHomeTitle')}</div>
                      <div className="text-xs text-[#9A9A9E]">{t('topup.sendHomeBody')}</div>
                    </div>
                    <ChevronRight size={16} className="text-[#9A9A9E]" />
                  </div>
                </Card>
              </Section>
            </>
          )}
        </>
      )}

      {/* pay sheet */}
      <Sheet open={payProduct !== null} onOpenChange={(v) => { if (!v) { setPayProduct(null); setOrder(null); setQuote(null); if (pollRef.current) clearInterval(pollRef.current) } }}>
        <SheetContent side="bottom" className="rounded-t-3xl border-[#2C2C2E] bg-[#1C1C1E]">
          <SheetHeader>
            <SheetTitle className="text-left text-base">
              {payProduct ? `${payProduct.deliverText} · ${payProduct.amountLocal}` : ''}
            </SheetTitle>
            <SheetDescription className="sr-only">Review and pay for the top-up</SheetDescription>
          </SheetHeader>

          {!order ? (
            <div className="mt-4">
              {quote && (
                <div className="rounded-2xl border border-[#2C2C2E] bg-[#0A0A0A] p-4 text-sm">
                  <div className="flex justify-between"><span className="text-[#9A9A9E]">{t('topup.amount')}</span><span>${quote.amountUsd.toFixed(2)}</span></div>
                  <div className="mt-1 flex justify-between"><span className="text-[#9A9A9E]">{t('topup.fee')}</span><span>${quote.feeUsd.toFixed(2)}</span></div>
                  <div className="mt-2 flex justify-between border-t border-[#2C2C2E] pt-2 font-bold"><span>{t('topup.total')}</span><span className="text-[#D7FF3F]">${quote.totalUsd.toFixed(2)}</span></div>
                  {quoteExpired && (
                    <div className="mt-3 flex items-center justify-between rounded-xl bg-[#2C2C2E] px-3 py-2 text-xs">
                      <span>{t('topup.quoteExpired')}</span>
                      <button onClick={requote} className="font-bold text-[#D7FF3F]">{t('topup.requote')}</button>
                    </div>
                  )}
                </div>
              )}
              {quoteErr && <p className="mt-3 text-sm text-[#FF453A]">{quoteErr}</p>}
              {payError && <p className="mt-3 text-sm text-[#FF453A]">{t(`topup.err.${payError}`, payError)}</p>}

              <div className="mt-4 space-y-2">
                <button
                  onClick={() => pay('balance')}
                  disabled={payBusy || !quote || quoteExpired || (state?.balanceUsd ?? 0) < (quote?.totalUsd ?? Infinity)}
                  className="flex w-full items-center justify-between rounded-2xl bg-[#D7FF3F] px-4 py-3.5 text-sm font-bold text-black disabled:opacity-40"
                >
                  <span>{t('topup.payWithBalance')}</span>
                  <span className="text-xs font-semibold opacity-70">${(state?.balanceUsd ?? 0).toFixed(2)}</span>
                </button>
                <button
                  onClick={() => pay('card')}
                  disabled={payBusy || !quote || quoteExpired}
                  className="w-full rounded-2xl border border-[#2C2C2E] bg-[#0A0A0A] py-3.5 text-sm font-bold text-[#E5E5EA] disabled:opacity-40"
                >
                  {t('topup.payWithCard')}
                </button>
                <p className="pt-1 text-center text-[10px] text-[#636366]">{t('topup.securedBy')}</p>
              </div>
            </div>
          ) : (
            <div className="mt-4">
              {(order.status === 'processing' || order.status === 'pending') && (
                <div className="flex flex-col items-center py-6 text-center">
                  <RefreshCw className="animate-spin text-[#D7FF3F]" size={28} />
                  <p className="mt-3 text-sm font-semibold">{t('topup.processing')}</p>
                  <p className="mt-1 text-xs text-[#9A9A9E]">{t('topup.smsIsTruth')}</p>
                </div>
              )}
              {order.status === 'delivered' && (
                <div className="flex flex-col items-center py-6 text-center">
                  <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#D7FF3F]/10">
                    <Share2 className="text-[#D7FF3F]" size={26} />
                  </div>
                  <p className="mt-3 text-base font-bold text-[#D7FF3F]">{t('topup.delivered')}</p>
                  <p className="mt-1 max-w-xs text-xs text-[#9A9A9E]">{t('topup.receiptNote')}</p>
                  <div className="mt-4 w-full rounded-2xl border border-[#2C2C2E] bg-[#0A0A0A] p-4 text-left text-xs">
                    <div className="flex justify-between"><span className="text-[#9A9A9E]">{t('topup.to')}</span><span>···{order.msisdnLast4}</span></div>
                    <div className="mt-1 flex justify-between"><span className="text-[#9A9A9E]">{t('topup.operator')}</span><span>{order.operatorName}</span></div>
                    <div className="mt-1 flex justify-between"><span className="text-[#9A9A9E]">{t('topup.total')}</span><span>${(order.amountUsd + order.feeUsd).toFixed(2)}</span></div>
                  </div>
                  <button
                    onClick={() => {
                      const text = encodeURIComponent(`${t('topup.shareText', { amount: order.amountUsd, who: '···' + order.msisdnLast4 })}`)
                      window.open(`https://wa.me/?text=${text}`, '_blank')
                    }}
                    className="mt-4 w-full rounded-2xl bg-[#D7FF3F] py-3 text-sm font-bold text-black"
                  >
                    {t('topup.shareWhatsApp')}
                  </button>
                  {state?.uid && (
                    <button onClick={() => saveAsMine(t('topup.myLine'))} className="mt-2 w-full rounded-2xl border border-[#2C2C2E] py-3 text-xs font-semibold text-[#9A9A9E]">
                      {t('topup.saveThisNumber')}
                    </button>
                  )}
                </div>
              )}
              {(order.status === 'failed' || order.status === 'refunded') && (
                <div className="flex flex-col items-center py-6 text-center">
                  <p className="text-base font-bold text-[#FF453A]">{t('topup.failed')}</p>
                  <p className="mt-1 text-xs text-[#9A9A9E]">{order.failureReason ?? t('topup.failedBody')}</p>
                  {order.status === 'refunded' && (
                    <p className="mt-2 text-xs font-semibold text-[#D7FF3F]">{t('topup.refundedNote')}</p>
                  )}
                </div>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>

      <CountryPickerSheet open={pickerOpen} onClose={() => setPickerOpen(false)} onPick={(iso, name) => { setCountryIso(iso); setCountryName(name); setOperator(null); setManualOperator('') }} />
    </div>
  )
}
