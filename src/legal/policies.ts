/**
 * Legal policies — single source of truth.
 *
 * The markdown lives in src/legal/*.md with {{token}} placeholders; the
 * substitution values live in legal-values.json. The in-app pages render
 * the result (pages/Legal.tsx) and the static-site generator
 * (scripts/build-legal.mjs) converts the SAME markdown + values to the
 * hosted HTML pages at /privacy, /terms, /refund. Edit once, both update.
 */
import privacyMd from './privacy.md?raw'
import termsMd from './terms.md?raw'
import refundMd from './refund.md?raw'
import { CONFIG } from '../config'
import valuesJson from './legal-values.json'

export interface LegalValues {
  operator: string
  updated: string
  supportEmail: string
  retentionYears: number
  chatRetentionMonths: number
  refundWindowDays: number
  governingCountry: string
  governingLocation: string
}

export const LEGAL_VALUES = valuesJson as LegalValues

export type LegalDoc = 'privacy' | 'terms' | 'refund'

export interface Policy {
  doc: LegalDoc
  title: string
  /** markdown with all {{tokens}} already substituted */
  markdown: string
  /** ISO date, rendered as "Last updated …" */
  updated: string
}

function substitute(md: string): string {
  const v = LEGAL_VALUES
  return md
    .replaceAll('{{operator}}', v.operator)
    .replaceAll('{{email}}', v.supportEmail)
    .replaceAll('{{retentionYears}}', String(v.retentionYears))
    .replaceAll('{{chatRetentionMonths}}', String(v.chatRetentionMonths))
    .replaceAll('{{refundDays}}', String(v.refundWindowDays))
    .replaceAll('{{refundUrl}}', CONFIG.legal.refunds)
    .replaceAll('{{country}}', v.governingCountry)
    .replaceAll('{{location}}', v.governingLocation)
}

function formatUpdated(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return iso
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(d)
}

export const POLICIES: Record<LegalDoc, Policy> = {
  privacy: {
    doc: 'privacy',
    title: 'Privacy Policy',
    markdown: substitute(privacyMd),
    updated: LEGAL_VALUES.updated,
  },
  terms: {
    doc: 'terms',
    title: 'Terms of Service',
    markdown: substitute(termsMd),
    updated: LEGAL_VALUES.updated,
  },
  refund: {
    doc: 'refund',
    title: 'Refund Policy',
    markdown: substitute(refundMd),
    updated: LEGAL_VALUES.updated,
  },
}

export function getPolicy(doc: string | undefined): Policy | null {
  if (doc === 'privacy' || doc === 'terms' || doc === 'refund') return POLICIES[doc]
  return null
}

export { formatUpdated }
