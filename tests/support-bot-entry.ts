/** esbuild entry re-exporting the mock bot (money/storage deps pull in
 *  config + localStorage — shim both for node. */
export * from '../src/lib/support-bot'

import { loadPurchases as _loadPurchases, savePurchases as _savePurchases } from '../src/lib/storage'

// storage shim for node (support-bot's refund lookup uses loadPurchases)
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

// seed one purchase so refund lookups find a price
store.set(
  'jum-esim:purchases:v1',
  JSON.stringify([
    {
      order: { id: 'ord_123', iccid: '8985200000000000001', qrUrl: '', lpaString: '', planId: 'germany-5gb-30d', email: 't@t.co', createdAt: 1 },
      plan: { id: 'germany-5gb-30d', countrySlug: 'germany', name: 'Germany 5GB', dataGB: 5, days: 30, priceUSD: 6.99, wholesaleUSD: 5, fiveG: true, networks: [], hotspot: true, group: 'data', label: '5 GB' },
      country: { slug: 'germany', name: 'Germany', iso2: 'DE', flag: '', region: 'europe', fiveG: true, networks: [], popular: true },
      status: 'not_installed',
      installedAt: null,
    },
  ]),
)

void _loadPurchases
void _savePurchases
