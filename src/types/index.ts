export type Region =
  | 'europe'
  | 'asia-pacific'
  | 'americas'
  | 'middle-east'
  | 'africa'
  | 'oceania'

export type DataAmount = number | 'unlimited'

export interface Country {
  slug: string
  name: string
  /** ISO-3166 alpha-2 (or XK) — key into pricing.json */
  iso2: string
  /** flag emoji, or 🌐 for regional bundles */
  flag: string
  region: Region
  fiveG: boolean
  networks: string[]
  popular: boolean
  /** true for multi-country regional / global bundles */
  isBundle?: boolean
  /** marketing line shown on the country card */
  coverageNote?: string
}

export type PlanBadge = 'bestseller' | 'popular'

/** the two plan groups every country sells (Module 2) */
export type PlanGroup = 'unlimited' | 'data'

export interface Plan {
  id: string
  countrySlug: string
  name: string
  dataGB: DataAmount
  days: number
  /** retail price from pricing.json (never hardcoded in components) */
  priceUSD: number
  /** estimated wholesale cost, analytics only */
  wholesaleUSD: number
  fiveG: boolean
  networks: string[]
  hotspot: boolean
  group: PlanGroup
  /** e.g. "7 Days" / "10 GB" */
  label: string
  /** e.g. "1.20 USD/GB" for data plans */
  unitDisplay?: string
  /** BESTSELLER / BEST VALUE / BEST VALUE - $X.XX/day */
  tag?: string
  badge?: PlanBadge
  /** required for unlimited plans — fair-usage disclosure */
  fairUseNote?: string
}

export interface Order {
  id: string
  iccid: string
  qrUrl: string
  lpaString: string
  planId: string
  email: string
  createdAt: number
  /** when set, this order tops up an existing eSIM (by iccid) */
  topUpFor?: string
}

export interface Usage {
  iccid: string
  usedMB: number
  totalMB: number
  /** for unlimited plans: the high-speed fair-usage cap shown to the user */
  fairUseCapMB: number | null
  activatedAt: number
  expiresAt: number
}

export type EsimStatus = 'not_installed' | 'active' | 'expired' | 'refunded'

export interface Purchase {
  order: Order
  plan: Plan
  country: Country
  status: EsimStatus
  installedAt: number | null
}

export type AnalyticsEvent =
  | 'search'
  | 'plan_view'
  | 'checkout_start'
  | 'purchase'
  | 'install_started'
  | 'install_completed'
  | 'topup'
  | 'refund'
  | 'number_country_viewed'
  | 'number_selected'
  | 'verify_started'
  | 'verify_completed'
  | 'call_outgoing'
  | 'number_released'
  | 'rental_renewed'
  | 'waitlist_joined'
  | 'setup_step_viewed'
  | 'setup_step_completed'
  | 'connection_test_passed'
  | 'connection_test_failed'
  | 'troubleshoot_fix_applied'
  | 'support_opened_from_setup'
  | 'legal_page_viewed'
  | 'chat_opened'
  | 'chat_message_sent'
  | 'bot_resolved'
  | 'bot_escalated_human'
  | 'refund_confirmed_via_chat'
  // Module 10 — Calls tab + WhatsApp support
  | 'calls_tab_opened'
  | 'buy_time_sheet_viewed'
  | 'credit_purchased'
  | 'call_started'
  | 'call_completed'
  | 'call_blocked_insufficient'
  | 'whatsapp_support_tapped'
  // Wallet checkout + post-purchase rating prompt
  | 'payment_method_selected'
  | 'payment_success'
  | 'payment_failed'
  // Store link-out (app never processes payment — jumesim.com does)
  | 'buy_linkout_tapped'
  | 'topup_linkout_tapped'
  | 'store_waitlist_joined'
  | 'rating_prompt_shown'
  | 'rating_store_opened'
  | 'rating_support_routed'
  | 'rating_dismissed'
  // ANTI-CHEAT REFUND — user-requested only, terminate-before-money-moves.
  // No auto-refund events exist: the server sequence is
  // verify unused → terminate at supplier → then Stripe refund.
  | 'refund_card_tapped'
  | 'refund_card_orders'
  | 'refund_button_viewed'
  | 'refund_requested'
  | 'refund_gate_passed'
  | 'refund_terminate_confirmed'
  | 'refund_denied_in_use'
  | 'refund_denied_cant_terminate'
  | 'refund_pending_manual'
  | 'refund_executed'
  // Top Up tab (5th nav item) — airtime & data for any phone line
  | 'topup_tab_opened'
  | 'topup_waitlist_joined'
  | 'topup_operator_detected'
  | 'topup_operator_changed'
  | 'topup_product_selected'
  | 'topup_quote_locked'
  | 'topup_quote_expired'
  | 'topup_balance_pay'
  | 'topup_card_pay'
  | 'topup_delivered'
  | 'topup_failed_refunded'
  | 'topup_saved_number'
  | 'topup_repeat_last'
  | 'topup_auto_created'
  | 'topup_auto_fired'
  | 'topup_fraud_wall'
  | 'topup_crosssell_esim_tapped'
  | 'topup_crosssell_home_tapped'
  // Jum Gift Cards — gifting tab, buy/redeem/admin funnel
  | 'gifts_tab_opened'
  | 'gift_buy_cta'
  | 'gift_product_selected'
  | 'gift_purchase_started'
  | 'gift_paid'
  | 'gift_purchase_mock_confirmed'
  | 'gift_share_whatsapp'
  | 'gift_redeem_previewed'
  | 'gift_redeemed_client'
  | 'gift_redeem_prefilled'
  | 'gift_redeem_link_opened'
  | 'gift_resend'
  | 'gift_fraud_wall'
  // Module 16 — user accounts (Firebase Auth) + order sync
  | 'auth_signup_started'
  | 'auth_signup_completed'
  | 'auth_login_completed'
  | 'auth_reset_requested'
  | 'account_linked_anonymous'
  | 'orders_restored'
  | 'account_deleted'
  // Module 17 — email verification + welcome emails
  | 'auth_verification_resent'
  | 'welcome_email_failed'
  | 'refund_blocked_unverified'
  // Module 15 — localization (language + currency)
  | 'language_detected'
  | 'language_changed'
  | 'currency_auto'
  | 'currency_changed'
  | 'missing_translation'

// ── Module 5 — rented numbers (caller ID) ───────────────────────────

export interface AvailableNumber {
  /** E.164, e.g. +14155550123 */
  number: string
  countryIso: string
  voice: boolean
  sms: boolean
  /** provider-assigned identifier (Twilio sid in live mode) */
  sid: string
}

export type NumberStatus = 'pending_verification' | 'active' | 'grace' | 'released'

// ── Module 10 — Calls tab ───────────────────────────────────────────

export interface CallRate {
  iso2: string
  country: string
  /** e.g. "+49" */
  dialCode: string
  /** USD per minute to mobiles — snapshot at call start is what's billed */
  mobilePerMin: number
  landlinePerMin: number
}

export interface CallHistoryEntry {
  id: string
  /** E.164 that was dialed */
  number: string
  iso2: string
  flag: string
  country: string
  durationSec: number
  costUSD: number
  /** completed = answered & billed · failed = never answered (no charge) */
  status: 'completed' | 'failed'
  at: number
}

export interface RentedNumber {
  sid: string
  number: string
  countryIso: string
  countryName: string
  /** monthly rental price at rent time */
  monthlyUSD: number
  rentedAt: number
  /** next monthly charge */
  renewsAt: number
  status: NumberStatus
  /** SMS verification state */
  verified: boolean
  /** KYC passed for regulated countries */
  kycPassed: boolean
}
