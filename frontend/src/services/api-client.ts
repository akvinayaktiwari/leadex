import type { ApiConnection, HealthStatus } from '@/types'
import { getPublicConfig } from './config'

export async function checkApiConnection(): Promise<ApiConnection> {
  const { apiUrl } = getPublicConfig()
  if (!apiUrl) return { state: 'unreachable', reason: 'NEXT_PUBLIC_API_URL is not set' }
  try {
    const response = await fetch(`${apiUrl}/api/health`, { credentials: 'include' })
    if (!response.ok) return { state: 'unreachable', reason: `API returned ${response.status}` }
    const health = (await response.json()) as HealthStatus
    return { state: 'connected', health }
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'network error'
    return { state: 'unreachable', reason }
  }
}
