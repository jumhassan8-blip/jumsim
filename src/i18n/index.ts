/**
 * i18n — auto-detected language + manual override.
 *
 * Web build uses `navigator.languages` as the stand-in for Expo's
 * `expo-localization.getLocales()` — identical mapping logic ships in the
 * native build. Detection → supported language (18 languages covering the
 * top traveler languages of all 190 markets) → persisted override wins.
 *
 * Fallback: every missing key resolves to English and is reported through
 * `missing_translation { key, lang }` — users NEVER see raw keys.
 *
 * RTL: Arabic flips the whole layout via `dir="rtl"` on <html>; directional
 * icons opt into mirroring with the `flip-rtl` class (index.css).
 */
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { track } from '../lib/analytics'
import { LANGUAGE_REGION as LANGUAGE_REGION_FALLBACK } from '../lib/currency-data'

import en from './locales/en.json'
import es from './locales/es.json'
import fr from './locales/fr.json'
import de from './locales/de.json'
import pt from './locales/pt.json'
import it from './locales/it.json'
import tr from './locales/tr.json'
import ar from './locales/ar.json'
import zh from './locales/zh.json'
import ja from './locales/ja.json'
import ko from './locales/ko.json'
import hi from './locales/hi.json'
import ru from './locales/ru.json'
import th from './locales/th.json'
import vi from './locales/vi.json'
import id from './locales/id.json'
import nl from './locales/nl.json'
import pl from './locales/pl.json'

export const SUPPORTED = [
  'en', 'es', 'fr', 'de', 'pt', 'it', 'tr', 'ar', 'zh',
  'ja', 'ko', 'hi', 'ru', 'th', 'vi', 'id', 'nl', 'pl',
] as const
export type Language = (typeof SUPPORTED)[number]

export const LANGUAGE_NAMES: Record<Language, string> = {
  en: 'English', es: 'Español', fr: 'Français', de: 'Deutsch',
  pt: 'Português', it: 'Italiano', tr: 'Türkçe', ar: 'العربية',
  zh: '中文', ja: '日本語', ko: '한국어', hi: 'हिन्दी',
  ru: 'Русский', th: 'ไทย', vi: 'Tiếng Việt', id: 'Bahasa Indonesia',
  nl: 'Nederlands', pl: 'Polski',
}

export const RTL_LANGUAGES: ReadonlySet<string> = new Set(['ar'])

const LANG_KEY = 'jum-esim:language:v1'
const reportedMissing = new Set<string>()

const resources = {
  en: { translation: en }, es: { translation: es }, fr: { translation: fr },
  de: { translation: de }, pt: { translation: pt }, it: { translation: it },
  tr: { translation: tr }, ar: { translation: ar }, zh: { translation: zh },
  ja: { translation: ja }, ko: { translation: ko }, hi: { translation: hi },
  ru: { translation: ru }, th: { translation: th }, vi: { translation: vi },
  id: { translation: id }, nl: { translation: nl }, pl: { translation: pl },
}

/** Map a BCP-47 tag (e.g. "pt-BR", "zh-Hans-CN") to a supported language. */
export function mapLocaleToLanguage(tag: string): Language | null {
  const base = tag.replace('_', '-').split('-')[0]?.toLowerCase() ?? ''
  if ((SUPPORTED as readonly string[]).includes(base)) return base as Language
  // zh-Hant / zh-TW still read simplified Chinese better than English
  if (base === 'zh') return 'zh'
  return null
}

/** First supported language across the device's locale list. */
export function detectLanguage(): Language {
  const tags: string[] =
    typeof navigator !== 'undefined'
      ? [...(navigator.languages ?? []), navigator.language]
      : []
  for (const tag of tags) {
    const lang = mapLocaleToLanguage(tag)
    if (lang) return lang
  }
  return 'en'
}

/** Initial language: stored override > device detection (> 'en'). */
export function initialLanguage(): Language {
  try {
    const stored = localStorage.getItem(LANG_KEY)
    if (stored && (SUPPORTED as readonly string[]).includes(stored)) {
      return stored as Language
    }
  } catch {
    /* storage unavailable — fall through to detection */
  }
  const detected = detectLanguage()
  // first-ever launch on a non-English device: report what we picked
  if (detected !== 'en') track('language_detected', { code: detected, source: 'auto' })
  return detected
}

function applyDirection(lang: string): void {
  const dir = RTL_LANGUAGES.has(lang) ? 'rtl' : 'ltr'
  if (typeof document !== 'undefined') {
    document.documentElement.dir = dir
    document.documentElement.lang = lang
  }
}

/** Manual override — persists across launches, reports the change. */
export function setLanguage(lang: Language): void {
  try {
    localStorage.setItem(LANG_KEY, lang)
  } catch {
    /* non-fatal */
  }
  void i18n.changeLanguage(lang)
  applyDirection(lang)
  track('language_changed', { code: lang })
}

/** The locale region the device reported (e.g. "TR" from "tr-TR"). */
export function deviceRegion(): string | null {
  const tags: string[] =
    typeof navigator !== 'undefined'
      ? [...(navigator.languages ?? []), navigator.language]
      : []
  for (const tag of tags) {
    const parts = tag.replace('_', '-').split('-')
    if (parts.length > 1) {
      const region = parts[parts.length - 1].toUpperCase()
      if (/^[A-Z]{2}$/.test(region)) return region
    }
  }
  return null
}

/** Formatting locale: active language + the device's region (or the
 *  language's default region) — drives Intl.NumberFormat separators. */
export function formatLocale(lang: string): string {
  const region = deviceRegion() ?? LANGUAGE_REGION_FALLBACK[lang] ?? 'US'
  return `${lang}-${region}`
}

export function initI18n(): typeof i18n {
  const start = initialLanguage()
  applyDirection(start)
  void i18n.use(initReactI18next).init({
    resources,
    lng: start,
    fallbackLng: 'en',
    supportedLngs: [...SUPPORTED],
    nonExplicitSupportedLngs: true,
    interpolation: { escapeValue: false },
    returnEmptyString: false,
    // raw keys must never leak: fall back to English, then to empty
    parseMissingKeyHandler: () => '',
    saveMissing: true,
    missingKeyHandler: (_lngs, _ns, key) => {
      const lang = i18n.language
      const id = `${lang}:${key}`
      if (!reportedMissing.has(id)) {
        reportedMissing.add(id)
        track('missing_translation', { key, lang })
      }
    },
  })
  return i18n
}

/** Translate outside React (toasts in stores, lib modules). Never returns a
 *  raw key: falls back to English, then to empty string. */
export function tt(key: string, options?: Record<string, unknown>): string {
  return i18n.t(key, options) ?? ''
}

export default i18n
