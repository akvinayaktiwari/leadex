'use client'

import { useApiConnection } from '@/hooks/use-api-connection'

export function ApiStatus() {
  const connection = useApiConnection()
  if (connection.state === 'checking') return <p className="status">Checking API…</p>
  if (connection.state === 'unreachable') {
    return <p className="status status-bad">API unreachable: {connection.reason}</p>
  }
  return (
    <p className="status status-ok">
      API connected · {connection.health.stage} · pipeline v{connection.health.pipelineVersion}
    </p>
  )
}
