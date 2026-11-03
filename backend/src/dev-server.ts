import { serve } from '@hono/node-server'
import { getConnInfo } from '@hono/node-server/conninfo'
import { createAnalyses, createApiServices, createRunStore } from './composition.js'
import { getApiEnv, getRunStoreEnv } from './lib/env.js'
import { logInfo } from './lib/logger.js'
import { createApp } from './routes/index.js'

const DEFAULT_PORT = 8787
const port = Number(process.env.PORT ?? DEFAULT_PORT)

const store = createRunStore(getRunStoreEnv())
const app = createApp(createApiServices(store, createAnalyses(store, getApiEnv(), getRunStoreEnv())), (c) => getConnInfo(c).remote.address)

serve({ fetch: app.fetch, port }, (info) => {
  logInfo('dev server listening', { port: info.port })
})
