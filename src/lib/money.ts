import { CONFIG } from '../config'

/**
 * Retail price = wholesale × markup, rounded up to the nearest $x.99.
 * This is the single place the margin is applied before displaying prices.
 */
export function retailPrice(wholesaleUSD: number): number {
  return Math.max(0.99, Math.round(wholesaleUSD * CONFIG.markup) - 0.01)
}

export function formatUSD(v: number): string {
  return `$${v.toFixed(2)}`
}

export function formatPlanSize(dataGB: number | 'unlimited'): string {
  return dataGB === 'unlimited' ? 'Unlimited' : `${dataGB}GB`
}
