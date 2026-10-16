/** esbuild entry for the WhatsApp helper unit test — stubs the DOM bits
 *  (window.open / location / localStorage for analytics) before importing. */

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

const origError = console.error
console.error = (...args: unknown[]) => {
  errors.push(args)
}

export const harness = { opened, locations, errors, origError }

export {
  openWhatsApp,
  setWhatsAppLinking,
  whatsappAppUrl,
  whatsappWebUrl,
  buildSupportPrefill,
  type SupportContext,
} from '../src/lib/whatsapp'
