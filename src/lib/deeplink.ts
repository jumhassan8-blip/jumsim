/** build a shareable deep link (/country/germany, /plan/{id}) */
export function deepLink(path: string): string {
  return `${window.location.origin}${path.startsWith('/') ? path : `/${path}`}`
}

export async function shareOrCopy(title: string, path: string): Promise<'shared' | 'copied'> {
  const url = deepLink(path)
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ title, url })
      return 'shared'
    } catch {
      /* user dismissed — fall through to clipboard */
    }
  }
  await navigator.clipboard.writeText(url)
  return 'copied'
}
