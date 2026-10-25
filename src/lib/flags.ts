/** ISO alpha-2 → flag emoji (same derivation the catalog uses). */
export function flagFor(iso2: string): string {
  const code = iso2.toUpperCase()
  if (code.length !== 2) return '🌐'
  return String.fromCodePoint(
    ...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65),
  )
}
