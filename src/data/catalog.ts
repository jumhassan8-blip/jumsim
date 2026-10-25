import type { Country, Region } from '../types'

/**
 * Raw country list: "Name|ISO" — flags are derived from ISO codes so the
 * catalog stays compact. 198 destinations, matching the "190+ countries" claim.
 */
const RAW: Array<[string, string]> = [
  ['Albania', 'AL'], ['Andorra', 'AD'], ['Austria', 'AT'], ['Belarus', 'BY'],
  ['Belgium', 'BE'], ['Bosnia and Herzegovina', 'BA'], ['Bulgaria', 'BG'],
  ['Croatia', 'HR'], ['Cyprus', 'CY'], ['Czechia', 'CZ'], ['Denmark', 'DK'],
  ['Estonia', 'EE'], ['Finland', 'FI'], ['France', 'FR'], ['Germany', 'DE'],
  ['Greece', 'GR'], ['Hungary', 'HU'], ['Iceland', 'IS'], ['Ireland', 'IE'],
  ['Italy', 'IT'], ['Latvia', 'LV'], ['Liechtenstein', 'LI'], ['Lithuania', 'LT'],
  ['Luxembourg', 'LU'], ['Malta', 'MT'], ['Moldova', 'MD'], ['Monaco', 'MC'],
  ['Montenegro', 'ME'], ['Netherlands', 'NL'], ['North Macedonia', 'MK'],
  ['Norway', 'NO'], ['Poland', 'PL'], ['Portugal', 'PT'], ['Romania', 'RO'],
  ['Russia', 'RU'], ['San Marino', 'SM'], ['Serbia', 'RS'], ['Slovakia', 'SK'],
  ['Slovenia', 'SI'], ['Spain', 'ES'], ['Sweden', 'SE'], ['Switzerland', 'CH'],
  ['Ukraine', 'UA'], ['United Kingdom', 'GB'], ['Vatican City', 'VA'],
  ['Afghanistan', 'AF'], ['Armenia', 'AM'], ['Azerbaijan', 'AZ'], ['Bahrain', 'BH'],
  ['Bangladesh', 'BD'], ['Bhutan', 'BT'], ['Brunei', 'BN'], ['Cambodia', 'KH'],
  ['China', 'CN'], ['Georgia', 'GE'], ['Hong Kong', 'HK'], ['India', 'IN'],
  ['Indonesia', 'ID'], ['Iran', 'IR'], ['Iraq', 'IQ'], ['Israel', 'IL'],
  ['Japan', 'JP'], ['Jordan', 'JO'], ['Kazakhstan', 'KZ'], ['Kuwait', 'KW'],
  ['Kyrgyzstan', 'KG'], ['Laos', 'LA'], ['Lebanon', 'LB'], ['Macao', 'MO'],
  ['Malaysia', 'MY'], ['Maldives', 'MV'], ['Mongolia', 'MN'], ['Myanmar', 'MM'],
  ['Nepal', 'NP'], ['North Korea', 'KP'], ['Oman', 'OM'], ['Pakistan', 'PK'],
  ['Palestine', 'PS'], ['Philippines', 'PH'], ['Qatar', 'QA'], ['Saudi Arabia', 'SA'],
  ['Singapore', 'SG'], ['South Korea', 'KR'], ['Sri Lanka', 'LK'], ['Syria', 'SY'],
  ['Taiwan', 'TW'], ['Tajikistan', 'TJ'], ['Thailand', 'TH'], ['Timor-Leste', 'TL'],
  ['Turkey', 'TR'], ['Turkmenistan', 'TM'], ['United Arab Emirates', 'AE'],
  ['Uzbekistan', 'UZ'], ['Vietnam', 'VN'], ['Yemen', 'YE'],
  ['Antigua and Barbuda', 'AG'], ['Argentina', 'AR'], ['Bahamas', 'BS'],
  ['Barbados', 'BB'], ['Belize', 'BZ'], ['Bolivia', 'BO'], ['Brazil', 'BR'],
  ['Canada', 'CA'], ['Chile', 'CL'], ['Colombia', 'CO'], ['Costa Rica', 'CR'],
  ['Cuba', 'CU'], ['Dominica', 'DM'], ['Dominican Republic', 'DO'],
  ['Ecuador', 'EC'], ['El Salvador', 'SV'], ['Grenada', 'GD'], ['Guatemala', 'GT'],
  ['Guyana', 'GY'], ['Haiti', 'HT'], ['Honduras', 'HN'], ['Jamaica', 'JM'],
  ['Mexico', 'MX'], ['Nicaragua', 'NI'], ['Panama', 'PA'], ['Paraguay', 'PY'],
  ['Peru', 'PE'], ['Saint Kitts and Nevis', 'KN'], ['Saint Lucia', 'LC'],
  ['Saint Vincent and the Grenadines', 'VC'], ['Suriname', 'SR'],
  ['Trinidad and Tobago', 'TT'], ['United States', 'US'], ['Uruguay', 'UY'],
  ['Venezuela', 'VE'],
  ['Algeria', 'DZ'], ['Angola', 'AO'], ['Benin', 'BJ'], ['Botswana', 'BW'],
  ['Burkina Faso', 'BF'], ['Burundi', 'BI'], ['Cabo Verde', 'CV'], ['Cameroon', 'CM'],
  ['Central African Republic', 'CF'], ['Chad', 'TD'], ['Comoros', 'KM'],
  ['Congo', 'CG'], ['DR Congo', 'CD'], ['Côte d’Ivoire', 'CI'], ['Djibouti', 'DJ'],
  ['Egypt', 'EG'], ['Equatorial Guinea', 'GQ'], ['Eritrea', 'ER'], ['Eswatini', 'SZ'],
  ['Ethiopia', 'ET'], ['Gabon', 'GA'], ['Gambia', 'GM'], ['Ghana', 'GH'],
  ['Guinea', 'GN'], ['Guinea-Bissau', 'GW'], ['Kenya', 'KE'], ['Lesotho', 'LS'],
  ['Liberia', 'LR'], ['Libya', 'LY'], ['Madagascar', 'MG'], ['Malawi', 'MW'],
  ['Mali', 'ML'], ['Mauritania', 'MR'], ['Mauritius', 'MU'], ['Morocco', 'MA'],
  ['Mozambique', 'MZ'], ['Namibia', 'NA'], ['Niger', 'NE'], ['Nigeria', 'NG'],
  ['Rwanda', 'RW'], ['Sao Tome and Principe', 'ST'], ['Senegal', 'SN'],
  ['Seychelles', 'SC'], ['Sierra Leone', 'SL'], ['Somalia', 'SO'], ['South Africa', 'ZA'],
  ['South Sudan', 'SS'], ['Sudan', 'SD'], ['Tanzania', 'TZ'], ['Togo', 'TG'],
  ['Tunisia', 'TN'], ['Uganda', 'UG'], ['Zambia', 'ZM'], ['Zimbabwe', 'ZW'],
  ['Australia', 'AU'], ['Fiji', 'FJ'], ['Kiribati', 'KI'], ['Marshall Islands', 'MH'],
  ['Micronesia', 'FM'], ['Nauru', 'NR'], ['New Zealand', 'NZ'], ['Palau', 'PW'],
  ['Papua New Guinea', 'PG'], ['Samoa', 'WS'], ['Solomon Islands', 'SB'],
  ['Tonga', 'TO'], ['Tuvalu', 'TV'], ['Vanuatu', 'VU'],
  // territories covered by the 190-country pricing file (tier 2 unless noted)
  ['Puerto Rico', 'PR'], ['Guam', 'GU'], ['Cayman Islands', 'KY'], ['Aruba', 'AW'],
  ['Curaçao', 'CW'], ['Bermuda', 'BM'], ['French Guiana', 'GF'], ['Réunion', 'RE'],
  ['Guadeloupe', 'GP'], ['Martinique', 'MQ'], ['Gibraltar', 'GI'], ['Faroe Islands', 'FO'],
  ['Jersey', 'JE'], ['Guernsey', 'GG'], ['Isle of Man', 'IM'], ['Kosovo', 'XK'],
]

/** ISO-3166 alpha-2 → region */
const REGION_BY_CODE: Record<string, Region> = {}
const setRegion = (codes: string, region: Region): void => {
  for (let i = 0; i < codes.length; i += 2) {
    REGION_BY_CODE[codes.slice(i, i + 2)] = region
  }
}
setRegion(
  'ALADATBYBEBABGHRCYCYDKEEFIFRDEGRHUIUISIEITLVLILTLUMCMDMCMENLMKNOPLPTRORUSMRSRSSKSISIESSCHUAGBVA',
  'europe',
)
setRegion(
  'AFAMAZBHBD BTBHKHCNCNGEHKINIDIRIQILJPJOKZKWKGLALBMOMYMVMNMMNPKPOMPKPSPHQASASKRSYTW TJTH TLTRTMAEUZVN YE'.replace(/ /g, ''),
  'asia-pacific',
)
setRegion(
  'AGARB SBBZBOBRCACLCOCR CUDO EC SV GD GTGYHT HN JM MX NI PA PY PE KN LC VC SR TT US UY VE'.replace(/ /g, ''),
  'americas',
)
setRegion('BHIRIQILJOKWLBOMQASASYAE', 'middle-east')
setRegion(
  'DZAOBJBWBFBICVCMCMTDKMCGCD CIEJGQE R SZ ET GAGMGH GNGW KELS LRLY MG MW ML MR MU MA MZ NA NE NG RW ST SN SC SL SO ZA SS SD TZ TG TN UG ZM ZW'.replace(/ /g, ''),
  'africa',
)
setRegion('AUFJKIMHFMNRNZPWP GWSB TO TV VU'.replace(/ /g, ''), 'oceania')

const EUROPE_NETS = ['Orange', 'Vodafone', 'Telefónica', 'Deutsche Telekom']
const ASIA_NETS = ['SoftBank', 'AIS', 'Singtel', 'SK Telecom']
const AMERICA_NETS = ['Claro', 'Movistar', 'AT&T', 'T-Mobile']
const MEA_NETS = ['Etisalat', 'du', 'MTN', 'Vodacom']
const OCEANIA_NETS = ['Telstra', 'Optus', 'Spark']

function networkPool(region: Region): string[] {
  switch (region) {
    case 'europe':
      return EUROPE_NETS
    case 'asia-pacific':
      return ASIA_NETS
    case 'americas':
      return AMERICA_NETS
    case 'oceania':
      return OCEANIA_NETS
    default:
      return MEA_NETS
  }
}

/** Hand-curated countries shown on Home / given real partner networks. */
const CURATED: Record<string, Partial<Country>> = {
  germany: {
    popular: true,
    fiveG: true,
    networks: ['Deutsche Telekom', 'Vodafone', 'O2'],
    coverageNote: '5G on Deutsche Telekom & Vodafone',
  },
  japan: {
    popular: true,
    fiveG: true,
    networks: ['NTT Docomo', 'SoftBank', 'KDDI'],
    coverageNote: '5G in Tokyo, Osaka & 200+ cities',
  },
  'united-states': {
    popular: true,
    fiveG: true,
    networks: ['T-Mobile', 'AT&T'],
    coverageNote: '5G nationwide on T-Mobile & AT&T',
  },
  indonesia: {
    popular: true,
    fiveG: true,
    networks: ['Telkomsel', 'XL Axiata'],
    coverageNote: 'Includes Bali, Jakarta & Lombok',
  },
  thailand: {
    popular: true,
    fiveG: true,
    networks: ['AIS', 'TrueMove H'],
    coverageNote: '5G in Bangkok, Phuket & Chiang Mai',
  },
  'united-kingdom': {
    popular: true,
    fiveG: true,
    networks: ['EE', 'O2', 'Vodafone UK'],
    coverageNote: '5G across 1,000+ UK towns',
  },
  france: {
    fiveG: true,
    networks: ['Orange', 'SFR', 'Bouygues'],
  },
  spain: { fiveG: true, networks: ['Movistar', 'Orange', 'Vodafone ES'] },
  italy: { fiveG: true, networks: ['TIM', 'Vodafone IT', 'WindTre'] },
  australia: { fiveG: true, networks: ['Telstra', 'Optus'] },
  'south-korea': { fiveG: true, networks: ['SK Telecom', 'KT'] },
  singapore: { fiveG: true, networks: ['Singtel', 'StarHub'] },
  'united-arab-emirates': { fiveG: true, networks: ['Etisalat', 'du'] },
  brazil: { fiveG: true, networks: ['Vivo', 'Claro BR'] },
  canada: { fiveG: true, networks: ['Rogers', 'Bell'] },
  netherlands: { fiveG: true, networks: ['KPN', 'Vodafone NL'] },
  switzerland: { fiveG: true, networks: ['Swisscom', 'Sunrise'] },
  turkey: { fiveG: true, networks: ['Turkcell', 'Vodafone TR'] },
  vietnam: { networks: ['Viettel', 'Vinaphone'] },
  malaysia: { fiveG: true, networks: ['Maxis', 'CelcomDigi'] },
  philippines: { networks: ['Globe', 'Smart'] },
  india: { networks: ['Jio', 'Airtel'] },
  mexico: { fiveG: true, networks: ['Telcel', 'AT&T MX'] },
  'new-zealand': { fiveG: true, networks: ['Spark', 'One NZ'] },
  egypt: { networks: ['Vodafone EG', 'Orange EG'] },
  'south-africa': { fiveG: true, networks: ['Vodacom', 'MTN'] },
  kenya: { networks: ['Safaricom', 'Airtel KE'] },
  morocco: { networks: ['Maroc Telecom', 'Orange MA'] },
  israel: { fiveG: true, networks: ['Cellcom', 'Partner'] },
  qatar: { fiveG: true, networks: ['Ooredoo', 'Vodafone QA'] },
  'saudi-arabia': { fiveG: true, networks: ['STC', 'Mobily'] },
  argentina: { networks: ['Movistar AR', 'Personal'] },
  chile: { fiveG: true, networks: ['Entel', 'Movistar CL'] },
  colombia: { networks: ['Claro CO', 'Movistar CO'] },
  peru: { networks: ['Movistar PE', 'Claro PE'] },
}

export function flagEmoji(code: string): string {
  return code
    .toUpperCase()
    .replace(/./g, (c) => String.fromCodePoint(0x1f1e6 - 65 + c.charCodeAt(0)))
}

/** deterministic 32-bit hash for stable pseudo-random catalog generation */
export function hash32(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

const GENERIC_FIVEG_SKIP = new Set([
  'afghanistan', 'north-korea', 'cuba', 'iran', 'syria', 'sudan', 'south-sudan',
  'yemen', 'libya', 'eritrea', 'somalia', 'central-african-republic',
])

export function buildCountries(): Country[] {
  const countries: Country[] = RAW.map(([name, code]) => {
    const slug = slugify(name)
    const region: Region = REGION_BY_CODE[code] ?? 'europe'
    const curated = CURATED[slug]
    const h = hash32(slug)
    const fiveG = curated?.fiveG ?? (!GENERIC_FIVEG_SKIP.has(slug) && h % 3 !== 0)
    const pool = networkPool(region)
    const networks =
      curated?.networks ??
      [pool[h % pool.length], pool[(h >> 3) % pool.length]].filter(
        (n, i, a) => a.indexOf(n) === i,
      )
    return {
      slug,
      name,
      iso2: code,
      flag: flagEmoji(code),
      region,
      fiveG,
      networks,
      popular: curated?.popular ?? false,
      coverageNote: curated?.coverageNote,
    }
  })

  // regional bundles (globe icon) — sold alongside countries
  countries.unshift(
    {
      slug: 'global',
      name: 'Global 190+ Countries',
      iso2: 'GL',
      flag: '🌐',
      region: 'europe',
      fiveG: true,
      networks: ['300+ partner networks'],
      popular: false,
      isBundle: true,
      coverageNote: 'One eSIM for almost everywhere',
    },
    {
      slug: 'asia-pacific',
      name: 'Asia Pacific',
      iso2: 'AS',
      flag: '🌏',
      region: 'asia-pacific',
      fiveG: true,
      networks: ['SoftBank', 'AIS', 'Singtel', 'Telstra'],
      popular: false,
      isBundle: true,
      coverageNote: '18 countries · one plan',
    },
    {
      slug: 'europe',
      name: 'Europe Regional',
      iso2: 'EU',
      flag: '🇪🇺',
      region: 'europe',
      fiveG: true,
      networks: ['Orange', 'Vodafone', 'Telefónica', 'Deutsche Telekom'],
      popular: false,
      isBundle: true,
      coverageNote: '35+ countries · one plan',
    },
  )
  return countries
}
