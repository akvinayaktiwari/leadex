// API Lambda (Function URL, BUFFERED invoke mode). Every route except the SSE stream.
import { handle } from 'hono/aws-lambda'
import { createApiServices, createRunStore } from './src/composition.js'
import { getApiEnv, getRunStoreEnv } from './src/lib/env.js'
import { initSentry } from './src/lib/sentry.js'
import { createApp } from './src/routes/index.js'

initSentry('api', getApiEnv())

export const handler = handle(createApp(createApiServices(createRunStore(getRunStoreEnv()))))
