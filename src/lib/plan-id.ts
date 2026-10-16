/**
 * Plan-ID parsing (single source of truth).
 *
 * Plan ids are built as:
 *   unlimited      : {slug}-unl-{days}d        e.g. germany-unl-7d
 *   data           : {slug}-{gb}gb-{days}d     e.g. germany-5gb-30d
 *   bundle plans   : {slug}-{label}            e.g. europe-10gb / global-5gb
 *
 * The parser also lives in server/production-server.mjs (price authority).
 * If you change one, change both — checkout resolves ids with THIS parser
 * only.
 */
export interface ParsedPlanId {
  slug: string
  kind: 'unlimited' | 'data' | 'bundle'
  days?: number
  gb?: number
  bundleLabel?: string
}

export function parsePlanId(planId: string): ParsedPlanId | null {
  let m = planId.match(/^(.*)-unl-(\d+)d$/)
  if (m) return { slug: m[1], kind: 'unlimited', days: Number(m[2]) }
  m = planId.match(/^(.*)-(\d+(?:p5)?)gb-(\d+)d$/)
  if (m) return { slug: m[1], kind: 'data', gb: Number(m[2].replace('p5', '.5')), days: Number(m[3]) }
  m = planId.match(/^(.*)-(.+)$/)
  if (m) return { slug: m[1], kind: 'bundle', bundleLabel: m[2] }
  return null
}

/** the plan-list ↔ checkout contract: both sides build ids with this */
export function buildPlanId(
  slug: string,
  kind: 'unlimited' | 'data' | 'bundle',
  value: { days?: number; gb?: number; bundleLabel?: string },
): string {
  if (kind === 'unlimited') return `${slug}-unl-${value.days}d`
  if (kind === 'data') return `${slug}-${String(value.gb).replace('.', 'p5')}gb-${value.days ?? 30}d`
  return `${slug}-${value.bundleLabel ?? ''}`
}
