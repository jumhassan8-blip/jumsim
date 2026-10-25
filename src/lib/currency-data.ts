/**
 * Currency geography — the single source for "which currency does a locale
 * (or a destination) use". Base prices stay USD in pricing.json; conversion
 * is display-only (Stripe charges USD — card networks convert for the user).
 *
 * REGION_TO_CURRENCY covers every territory in the catalog (198 destinations,
 * 215 ISO codes incl. territories) — no country falls back to a guessed
 * display. "Auto" currency = the device's locale region → its currency.
 */

/** ISO 3166-1 alpha-2 → ISO 4217. */
export const REGION_TO_CURRENCY: Record<string, string> = {
  AD: 'EUR', AE: 'AED', AF: 'AFN', AG: 'XCD', AL: 'ALL', AM: 'AMD',
  AO: 'AOA', AR: 'ARS', AT: 'EUR', AU: 'AUD', AW: 'AWG', AZ: 'AZN',
  BA: 'BAM', BB: 'BBD', BD: 'BDT', BE: 'EUR', BF: 'XOF', BG: 'BGN',
  BH: 'BHD', BI: 'BIF', BJ: 'XOF', BM: 'BMD', BN: 'BND', BO: 'BOB',
  BR: 'BRL', BS: 'BSD', BT: 'BTN', BW: 'BWP', BY: 'BYN', BZ: 'BZD',
  CA: 'CAD', CD: 'CDF', CF: 'XAF', CG: 'XAF', CH: 'CHF', CI: 'XOF',
  CL: 'CLP', CM: 'XAF', CN: 'CNY', CO: 'COP', CR: 'CRC', CU: 'CUP',
  CV: 'CVE', CW: 'ANG', CY: 'EUR', CZ: 'CZK', DE: 'EUR', DJ: 'DJF',
  DK: 'DKK', DM: 'XCD', DO: 'DOP', DZ: 'DZD', EC: 'USD', EE: 'EUR',
  EG: 'EGP', ER: 'ERN', ES: 'EUR', ET: 'ETB', FI: 'EUR', FJ: 'FJD',
  FM: 'USD', FO: 'DKK', FR: 'EUR', GA: 'XAF', GB: 'GBP', GD: 'XCD',
  GE: 'GEL', GF: 'EUR', GG: 'GBP', GH: 'GHS', GI: 'GBP', GM: 'GMD',
  GN: 'GNF', GP: 'EUR', GQ: 'XAF', GR: 'EUR', GT: 'GTQ', GU: 'USD',
  GW: 'XOF', GY: 'GYD', HK: 'HKD', HN: 'HNL', HR: 'EUR', HT: 'HTG',
  HU: 'HUF', ID: 'IDR', IE: 'EUR', IL: 'ILS', IM: 'GBP', IN: 'INR',
  IQ: 'IQD', IR: 'IRR', IS: 'ISK', IT: 'EUR', JE: 'GBP', JM: 'JMD',
  JO: 'JOD', JP: 'JPY', KE: 'KES', KG: 'KGS', KH: 'KHR', KI: 'AUD',
  KM: 'KMF', KN: 'XCD', KP: 'KPW', KR: 'KRW', KT: 'EUR', KW: 'KWD',
  KY: 'KYD', KZ: 'KZT', LA: 'LAK', LB: 'LBP', LC: 'XCD', LI: 'CHF',
  LK: 'LKR', LR: 'LRD', LS: 'LSL', LT: 'EUR', LU: 'EUR', LV: 'EUR',
  LY: 'LYD', MA: 'MAD', MC: 'EUR', MD: 'MDL', ME: 'EUR', MG: 'MGA',
  MH: 'USD', MK: 'MKD', ML: 'XOF', MM: 'MMK', MN: 'MNT', MO: 'MOP',
  MQ: 'EUR', MR: 'MRU', MT: 'EUR', MU: 'MUR', MV: 'MVR', MW: 'MWK',
  MX: 'MXN', MY: 'MYR', MZ: 'MZN', NA: 'NAD', NE: 'XOF', NG: 'NGN',
  NI: 'NIO', NL: 'EUR', NO: 'NOK', NP: 'NPR', NR: 'AUD', NZ: 'NZD',
  OM: 'OMR', PA: 'USD', PE: 'PEN', PG: 'PGK', PH: 'PHP', PK: 'PKR',
  PL: 'PLN', PR: 'USD', PS: 'ILS', PT: 'EUR', PW: 'USD', PY: 'PYG',
  QA: 'QAR', RE: 'EUR', RO: 'RON', RS: 'RSD', RU: 'RUB', RW: 'RWF',
  SA: 'SAR', SB: 'SBD', SC: 'SCR', SD: 'SDG', SE: 'SEK', SG: 'SGD',
  SI: 'EUR', SK: 'EUR', SL: 'SLE', SM: 'EUR', SN: 'XOF', SO: 'SOS',
  SR: 'SRD', SS: 'SSP', ST: 'STN', SV: 'USD', SY: 'SYP', SZ: 'SZL',
  TD: 'XAF', TG: 'XOF', TH: 'THB', TJ: 'TJS', TL: 'USD', TM: 'TMT',
  TN: 'TND', TO: 'TOP', TR: 'TRY', TT: 'TTD', TV: 'AUD', TW: 'TWD',
  UA: 'UAH', UG: 'UGX', US: 'USD', UY: 'UYU', UZ: 'UZS', VA: 'EUR',
  VC: 'XCD', VE: 'VES', VN: 'VND', VU: 'VUV', WS: 'WST', XK: 'EUR',
  YE: 'YER', ZA: 'ZAR', ZM: 'ZMW', ZW: 'ZWG',
}

/** Currencies that are practically zero-decimal (cash rounding). */
export const ZERO_DECIMAL: ReadonlySet<string> = new Set([
  'BIF', 'CLP', 'DJF', 'GNF', 'JPY', 'KMF', 'KRW', 'KPW',
  'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'WST', 'XAF', 'XOF', 'XPF',
])

/** Language → default region when the device locale carries no region tag
 *  (e.g. "de" alone → Germany → EUR). */
export const LANGUAGE_REGION: Record<string, string> = {
  en: 'US', es: 'ES', fr: 'FR', de: 'DE', pt: 'BR', it: 'IT',
  tr: 'TR', ar: 'EG', zh: 'CN', ja: 'JP', ko: 'KR', hi: 'IN',
  ru: 'RU', th: 'TH', vi: 'VN', id: 'ID', nl: 'NL', pl: 'PL',
}

/** All currencies the catalog can resolve to — the manual picker's list. */
export const ALL_CURRENCIES: string[] = [
  ...new Set(Object.values(REGION_TO_CURRENCY)),
].sort()

/** Localized currency name via Intl.DisplayNames (native in the UI language). */
export function currencyName(code: string, locale: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: 'currency' }).of(code) ?? code
  } catch {
    return code
  }
}

/** "EUR — Euro" style label for the picker; falls back to just the code. */
export function currencyLabel(code: string, locale: string): string {
  const name = currencyName(code, locale)
  return name === code ? code : `${code} — ${name}`
}
