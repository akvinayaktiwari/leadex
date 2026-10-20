import { serve } from '@hono/node-server'
import { logInfo } from './lib/logger.js'
import { createApp } from './routes/index.js'

const DEFAULT_PORT = 8787
const port = Number(process.env.PORT ?? DEFAULT_PORT)

serve({ fetch: createApp().fetch, port }, (info) => {
  logInfo('dev server listening', { port: info.port })
})
