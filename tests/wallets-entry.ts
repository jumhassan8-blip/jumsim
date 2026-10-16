/** esbuild entry — re-export only the pure visibility rule (avoids pulling
 *  CONFIG/localStorage into the node test; window is stubbed anyway). */
export { visibleWallets } from '../src/lib/wallets'

globalThis.window = {
  ApplePaySession: undefined,
  PaymentRequest: undefined,
} as unknown as Window & typeof globalThis
