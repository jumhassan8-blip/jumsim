/**
 * Provider registry — PROVIDER_TOPUP picks the implementation, exactly the
 * PROVIDER pattern the eSIM adapters already use (api/providers/index.ts).
 * Unknown/absent env → null → the app-wide "coming soon / waitlist" state.
 */
import type { TopUpProvider } from './types'
import { createReloadlyProvider } from './reloadly'
import { createMockTopUpProvider } from './mock'

export function topUpProviderName(): string {
  return (process.env.PROVIDER_TOPUP ?? '').trim().toLowerCase()
}

export function resolveTopUpProvider(): TopUpProvider | null {
  switch (topUpProviderName()) {
    case 'reloadly':
      return createReloadlyProvider()
    case 'mock':
      return createMockTopUpProvider()
    case 'ding':
    case 'prepay':
      // adapters land when the contract is needed; until then the env
      // value is recognized but treated as unconfigured (honest state)
      return null
    default:
      return null
  }
}

export type { TopUpProvider, TopUpProduct, TopUpQuote, TopUpExecution, DetectedOperator, TopUpKind } from './types'
