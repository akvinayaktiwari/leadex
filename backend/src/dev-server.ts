import { serve } from '@hono/node-server'
import { createApiServices, createRunStore } from './composition.js'
import { getApiEnv, getRunStoreEnv } from './lib/env.js'
import { logInfo } from './lib/logger.js'
import { createApp } from './routes/index.js'

const DEFAULT_PORT = 8787
const port = Number(process.env.PORT ?? DEFAULT_PORT)

serve({ fetch: createApp(createApiServices(createRunStore(getRunStoreEnv()), { enabled: getApiEnv().PUBLIC_ANALYSES_ENABLED, pipelineVersion: getApiEnv().PIPELINE_VERSION })).fetch, port }, (info) => {
  logInfo('dev server listening', { port: info.port })
})
