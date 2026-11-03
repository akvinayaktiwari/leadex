import type { ApiConnection, HealthStatus, StartAnalysisResult } from '@/types'
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

interface ErrorBody {
  error?: { code?: string; message?: string }
}

export interface StartAnalysisExtras {
  deviceId?: string
  turnstileToken?: string
}

export async function startAnalysis(url: string, extras: StartAnalysisExtras = {}): Promise<StartAnalysisResult> {
  const { apiUrl } = getPublicConfig()
  if (!apiUrl) return { ok: false, message: 'The app is not configured (NEXT_PUBLIC_API_URL is not set)' }
  try {
    const response = await fetch(`${apiUrl}/api/analyses`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'include', body: JSON.stringify({ url, ...extras }),
    })
    if (response.status === 202) {
      const body = (await response.json()) as { runId: string; domain: string }
      return { ok: true, runId: body.runId, domain: body.domain }
    }
    const body = (await response.json().catch(() => ({}))) as ErrorBody
    return { ok: false, message: body.error?.message ?? `Something went wrong (${response.status})` }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? `Could not reach Leadex: ${error.message}` : 'Could not reach Leadex' }
  }
}
