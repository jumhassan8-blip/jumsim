// Admin lookups — operate on hash fragments only, never plaintext codes.
import { listAllGifts } from '../lib/gift-store'
import type { GiftCard } from '../lib/gift-store'

export interface AdminGiftRow {
  id: string
  type: string
  amount: number
  unit: string
  status: string
  senderUid: string | null
  recipientName: string
  recipientEmail: string | null
  recipientWhatsapp: string | null
  codeHashPrefix: string
  createdAt: number
  paidAt: number | null
  sentAt: number | null
  redeemedAt: number | null
  scheduledAt: number | null
  refundedAt: number | null
  events: Array<{ t: number; event: string }>
}

export async function listGiftsByHashPrefix(fragment: string): Promise<AdminGiftRow[]> {
  const prefix = fragment.toLowerCase()
  const rows: AdminGiftRow[] = []
  for (const g of await listAllGifts()) {
    if (g.codeHash.startsWith(prefix)) rows.push(toAdminRow(g))
  }
  return rows
}

export function toAdminRow(g: GiftCard): AdminGiftRow {
  return {
    id: g.id,
    type: g.type,
    amount: g.amount,
    unit: g.unit,
    status: g.status,
    senderUid: g.senderUid,
    recipientName: g.recipient.name,
    recipientEmail: g.recipient.email,
    recipientWhatsapp: g.recipient.whatsapp,
    codeHashPrefix: g.codeHash.slice(0, 12),
    createdAt: g.createdAt,
    paidAt: g.paidAt,
    sentAt: g.sentAt,
    redeemedAt: g.redeemedAt,
    scheduledAt: g.scheduledAt,
    refundedAt: g.refundedAt,
    events: g.events,
  }
}
