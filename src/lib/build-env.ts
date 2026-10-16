/**
 * Build-environment helpers, kept in their own tiny module.
 *
 * Caution: esbuild/vite mis-fold boolean chains (`&&` / `||`) that mix an
 * import.meta.env-derived value with other operands — the expression can
 * collapse to a constant. Keep every env check INSIDE a helper function
 * here, and let consumers guard JSX with a single opaque call.
 */

export function isDevBuild(): boolean {
  return import.meta.env.MODE !== 'production'
}

export function isProductionBuild(): boolean {
  return import.meta.env.MODE === 'production'
}
