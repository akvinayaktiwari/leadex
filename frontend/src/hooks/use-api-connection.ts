'use client'

import { useEffect, useState } from 'react'
import { checkApiConnection } from '@/services/api-client'
import type { ApiConnection } from '@/types'

export function useApiConnection(): ApiConnection {
  const [connection, setConnection] = useState<ApiConnection>({ state: 'checking' })
  useEffect(() => {
    let active = true
    void checkApiConnection().then((result) => {
      if (active) setConnection(result)
    })
    return () => {
      active = false
    }
  }, [])
  return connection
}
