const configuredBackendUrl = (import.meta.env.VITE_BACKEND_URL || '').trim()

export const BACKEND_URL = configuredBackendUrl.replace(/\/+$/, '')

export function apiUrl(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return BACKEND_URL ? `${BACKEND_URL}${normalizedPath}` : normalizedPath
}
