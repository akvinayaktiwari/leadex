// A random id this browser keeps, sent with analyses as a second daily limit next to the IP. Not a fingerprint.
const STORAGE_KEY = 'leadex:device-id'

let fallback: string | undefined

export function getDeviceId(): string {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored) return stored
    const created = crypto.randomUUID()
    window.localStorage.setItem(STORAGE_KEY, created)
    return created
  } catch {
    // Storage blocked (private mode, settings): keep one id for this page load; the IP limit still applies.
    fallback ??= crypto.randomUUID()
    return fallback
  }
}
