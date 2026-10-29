export function getEmbedTypeFromUrl(url: string): 'dashboard' | 'report' {
  if (url.includes('/dashboard')) {
    return 'dashboard'
  }

  return 'report'
}
