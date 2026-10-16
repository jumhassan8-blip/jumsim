/**
 * Post-purchase rating prompt — state, eligibility rules, and the store-review
 * adapter.
 *
 * Trigger: payment succeeded AND the install is confirmed (the "Installation
 * successful!" moment — never before delivery).
 *
 * Frequency rules (do not nag):
 *  - max 1 rating prompt per purchased eSIM (perOrder map)
 *  - global cap: never show again for 90 days after any dismissal
 *  - never show if the user already rated (persisted flag)
 *  - never show during an active support/refund conversation
 *
 * Star split (deliberate — never send low ratings to the stores):
 *  - 4–5 stars → store review (StoreReview.requestReview() on iOS, Play
 *    listing intent on Android, jumesim.com/rate on web)
 *  - 1–3 stars → WhatsApp support chat via the existing openWhatsApp helper,
 *    prefilled "Hi! I rated my experience X stars because…"
 *
 * State: { lastPromptAt, rated, perOrder: { orderId: promptedAt },
 *          supportActiveUntil } persisted in localStorage / AsyncStorage.
 */

import { openInBrowser } from './whatsapp'
import { CONFIG } from '../config'

export interface RatingState {
  lastPromptAt: number
  rated: boolean
  /** orderId → timestamp the prompt was shown for that order */
  perOrder: Record<string, number>
  /** while Date.now() < supportActiveUntil, prompts are suppressed */
  supportActiveUntil: number
}

const RATING_KEY = 'jum-esim:rating:v1'
export const RATING_PROMPT_COOLDOWN_MS = 90 * 24 * 60 * 60 * 1000
/** a support/refund conversation stays "active" for this long after the last
 *  message — the rating prompt waits rather than nagging a user mid-ticket */
const SUPPORT_ACTIVE_MS = 24 * 60 * 60 * 1000

const DEFAULT_STATE: RatingState = {
  lastPromptAt: 0,
  rated: false,
  perOrder: {},
  supportActiveUntil: 0,
}

export function loadRatingState(): RatingState {
  try {
    const raw = localStorage.getItem(RATING_KEY)
    if (!raw) return { ...DEFAULT_STATE }
    const parsed = JSON.parse(raw) as Partial<RatingState>
    return {
      lastPromptAt: typeof parsed.lastPromptAt === 'number' ? parsed.lastPromptAt : 0,
      rated: Boolean(parsed.rated),
      perOrder:
        parsed.perOrder && typeof parsed.perOrder === 'object' ? parsed.perOrder : {},
      supportActiveUntil:
        typeof parsed.supportActiveUntil === 'number' ? parsed.supportActiveUntil : 0,
    }
  } catch {
    return { ...DEFAULT_STATE }
  }
}

export function saveRatingState(state: RatingState): void {
  try {
    localStorage.setItem(RATING_KEY, JSON.stringify(state))
  } catch {
    /* storage full / private mode — rating state is best-effort */
  }
}

/**
 * True when the prompt may be shown for this order. `isRefunded` covers the
 * "refund conversation" half of the guard; the support half lives in
 * supportActiveUntil.
 */
export function isRatingPromptEligible(orderId: string, isRefunded = false): boolean {
  if (isRefunded) return false
  const state = loadRatingState()
  if (state.rated) return false
  if (state.perOrder[orderId]) return false // max 1 prompt per purchased eSIM
  if (state.lastPromptAt && Date.now() - state.lastPromptAt < RATING_PROMPT_COOLDOWN_MS) {
    return false // 90-day global cap after any dismissal
  }
  if (Date.now() < state.supportActiveUntil) return false
  return true
}

/** Record that the prompt was shown for this order (fires before any star tap).
 *  Does NOT touch lastPromptAt — the 90-day global cap anchors at DISMISSAL. */
export function markPromptShown(orderId: string): void {
  const state = loadRatingState()
  state.perOrder[orderId] = Date.now()
  saveRatingState(state)
}

/** 4–5 stars: user rated — no more prompts ever. */
export function markRated(): void {
  const state = loadRatingState()
  state.rated = true
  saveRatingState(state)
}

/** "Maybe later": the 90-day global cap is anchored at the last dismissal. */
export function markPromptDismissed(): void {
  const state = loadRatingState()
  state.lastPromptAt = Date.now()
  saveRatingState(state)
}

/** SupportChat / refund flows call this so the prompt never interrupts a ticket. */
export function noteSupportActivity(): void {
  const state = loadRatingState()
  state.supportActiveUntil = Date.now() + SUPPORT_ACTIVE_MS
  saveRatingState(state)
}

/** Low-rating prefill routed into the WhatsApp support chat. */
export function ratingSupportPrefill(stars: number): string {
  return `Hi! I rated my experience ${stars} stars because… `
}

// ── store-review adapter ────────────────────────────────────────────────
// Native builds inject expo-store-review via setStoreReviewHandler(); the web
// build falls back to opening the jumesim.com/rate redirect page. Mirrors the
// setWhatsAppLinking injection pattern.

export interface StoreReviewLike {
  requestReview: () => Promise<void> | void
}

let nativeStoreReview: StoreReviewLike | null = null
const RATE_URL = `${CONFIG.siteUrl}/rate`

export function setStoreReviewHandler(handler: StoreReviewLike | null): void {
  nativeStoreReview = handler
}

function openRatePage(): void {
  try {
    openInBrowser(RATE_URL)
  } catch (err) {
    console.error('[rating] rate page failed to open', err)
    window.location.href = RATE_URL
  }
}

/** 4–5 stars → store review. Returns the URL opened on the web fallback. */
export function requestStoreReview(): string {
  if (nativeStoreReview) {
    try {
      Promise.resolve(nativeStoreReview.requestReview()).catch((err: unknown) => {
        console.error('[rating] StoreReview failed, falling back to rate page', err)
        openRatePage()
      })
    } catch (err) {
      // handler threw synchronously — same fallback, never a dead end
      console.error('[rating] StoreReview threw, falling back to rate page', err)
      openRatePage()
    }
    return RATE_URL
  }
  openRatePage()
  return RATE_URL
}
