/**
 * Account sheet — shown from the Profile auth card when signed in.
 * Account details, live sync status, sign out (local cache kept),
 * delete account (confirm step → auth user + cloud docs + local cache).
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LogOut, RefreshCw, Trash2, X } from 'lucide-react'
import { useAuth } from '../state/AuthContext'
import { useStore } from '../state/StoreContext'
import i18n from '../i18n'

/** "Last synced 2 min ago" — localized via Intl.RelativeTimeFormat. */
function relTime(ts: number): string {
  const diff = Date.now() - ts
  const sec = Math.round(diff / 1000)
  const rtf = new Intl.RelativeTimeFormat(i18n.language, { numeric: 'auto' })
  if (sec < 60) return rtf.format(-sec, 'second')
  const min = Math.round(sec / 60)
  if (min < 60) return rtf.format(-min, 'minute')
  const hrs = Math.round(min / 60)
  if (hrs < 48) return rtf.format(-hrs, 'hour')
  return rtf.format(-Math.round(hrs / 24), 'day')
}

export default function AccountSheet({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const { session, busy, signOut, deleteAccount, restorePurchases } = useAuth()
  const { toast } = useStore()
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [restoreMsg, setRestoreMsg] = useState<string | null>(null)
  const account = session.account

  if (!account) return null

  const doSignOut = async () => {
    await signOut() // local cache stays — the app keeps working offline
    toast(t('profile.signOutDone'), 'info')
    onClose()
  }

  const doRestore = async () => {
    setRestoreMsg(null)
    const count = await restorePurchases()
    setRestoreMsg(count > 0 ? t('auth.restoreDone', { count }) : t('auth.restoreNone'))
  }

  const doDelete = async () => {
    try {
      await deleteAccount()
      toast(t('profile.deleteDone'), 'info')
      onClose()
    } catch {
      toast(t('auth.errorGeneric'), 'error')
      setConfirmingDelete(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60"
      role="dialog"
      aria-modal="true"
      aria-label={t('profile.accountTitle')}
    >
      <div className="w-full max-w-md rounded-t-[24px] border-t border-[#2C2C2E] bg-[#161618] px-6 pb-8 pt-6">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-white">{t('profile.accountTitle')}</h2>
          <button
            onClick={onClose}
            aria-label={t('auth.back')}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-[#2C2C2E] text-white"
          >
            <X size={18} />
          </button>
        </div>

        {/* avatar + identity */}
        <div className="flex items-center gap-4">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-[#D7FF3F] text-xl font-bold text-black">
            {(account.email ?? '?').charAt(0).toUpperCase()}
          </span>
          <div className="min-w-0">
            <p className="truncate text-base font-semibold text-white">{account.email}</p>
            <p className="text-xs text-[#9A9A9E]">
              {t('profile.accountSince', {
                date: new Date(account.createdAt).toLocaleDateString(i18n.language),
              })}
            </p>
          </div>
        </div>

        {/* sync status */}
        <div className="mt-5 rounded-2xl bg-[#1C1C1E] p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-white">{t('profile.syncStatus')}</span>
            {session.syncedAt ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-[#32D74B]/15 px-2.5 py-1 text-[10px] font-bold text-[#32D74B]">
                {t('profile.synced')}
              </span>
            ) : (
              <span className="rounded-full bg-[#FF9F0A]/15 px-2.5 py-1 text-[10px] font-bold text-[#FF9F0A]">
                {t('profile.syncPending')}
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-[#9A9A9E]">
            {session.syncedAt
              ? t('profile.lastSynced', { time: relTime(session.syncedAt) })
              : t('profile.syncPendingBody')}
          </p>
        </div>

        {!confirmingDelete ? (
          <div className="mt-5 flex flex-col gap-2">
            {/* Module 16 Part 4 — email-match re-association, reachable signed-in
                (the Auth page bounces signed-in users, so the restore action
                lives here next to the sync status it affects) */}
            <button
              onClick={() => void doRestore()}
              disabled={busy}
              className="flex min-h-[50px] w-full items-center justify-center gap-2 rounded-2xl bg-[#2C2C2E] text-sm font-semibold text-white active:bg-[#3A3A3C] disabled:opacity-50"
            >
              <RefreshCw size={16} /> {t('auth.restoreCta')}
            </button>
            {restoreMsg && (
              <p className="text-center text-xs font-semibold text-[#32D74B]">{restoreMsg}</p>
            )}
            <button
              onClick={() => void doSignOut()}
              disabled={busy}
              className="flex min-h-[50px] w-full items-center justify-center gap-2 rounded-2xl bg-[#2C2C2E] text-sm font-semibold text-white active:bg-[#3A3A3C] disabled:opacity-50"
            >
              <LogOut size={16} /> {t('profile.signOut')}
            </button>
            <button
              onClick={() => setConfirmingDelete(true)}
              disabled={busy}
              className="flex min-h-[50px] w-full items-center justify-center gap-2 rounded-2xl border border-[#FF453A]/40 text-sm font-semibold text-[#FF6961] active:bg-[#FF453A]/10 disabled:opacity-50"
            >
              <Trash2 size={16} /> {t('profile.deleteAccount')}
            </button>
          </div>
        ) : (
          <div className="mt-5 rounded-2xl border border-[#FF453A]/40 bg-[#FF453A]/10 p-4">
            <p className="text-sm font-semibold text-white">{t('profile.deleteTitle')}</p>
            <p className="mt-2 text-xs leading-relaxed text-[#9A9A9E]">{t('profile.deleteBody')}</p>
            <button
              onClick={() => void doDelete()}
              disabled={busy}
              className="mt-4 flex min-h-[50px] w-full items-center justify-center rounded-2xl bg-[#FF453A] text-sm font-semibold text-white disabled:opacity-50"
            >
              {busy ? t('profile.deleting') : t('profile.deleteCta')}
            </button>
            <button
              onClick={() => setConfirmingDelete(false)}
              disabled={busy}
              className="mt-2 flex min-h-[48px] w-full items-center justify-center rounded-2xl bg-[#2C2C2E] text-sm font-semibold text-white disabled:opacity-50"
            >
              {t('profile.deleteKeep')}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
