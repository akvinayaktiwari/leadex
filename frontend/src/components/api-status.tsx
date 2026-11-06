'use client'

import { useApiConnection } from '@/hooks/use-api-connection'

export function ApiStatus() {
  const connection = useApiConnection()
  if (connection.state === 'checking') return <p className="mt-6 text-sm text-gray-500">Checking API…</p>
  if (connection.state === 'unreachable') {
    return <p className="mt-6 text-sm text-red-600">API unreachable: {connection.reason}</p>
  }
  return (
    <p className="mt-6 text-sm text-emerald-600">
      API connected · {connection.health.stage} · pipeline v{connection.health.pipelineVersion}
    </p>
  )
}
