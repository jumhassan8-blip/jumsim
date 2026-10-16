/** esbuild entry for the rating lib unit test — stubs window.open /
 *  location / localStorage (rating state + analytics) before importing. */

const opened: string[] = []
const locations: string[] = []
const errors: unknown[] = []

globalThis.window = {
  open: (url: string) => {
    opened.push(url)
    return null
  },
  location: new Proxy({} as Location, {
    set: (_t, _k, v) => {
      locations.push(String(v))
      return true
    },
  }),
} as unknown as Window & typeof globalThis

const store = new Map<string, string>()
globalThis.localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: () => null,
  get length() {
    return store.size
  },
} as Storage

console.error = (...args: unknown[]) => {
  errors.push(args)
}

export const harness = { opened, locations, errors, store }

export {
  loadRatingState,
  saveRatingState,
  isRatingPromptEligible,
  markPromptShown,
  markRated,
  markPromptDismissed,
  noteSupportActivity,
  ratingSupportPrefill,
  setStoreReviewHandler,
  requestStoreReview,
  RATING_PROMPT_COOLDOWN_MS,
} from '../src/lib/rating'
