// API Lambda (Function URL, BUFFERED invoke mode). Every route except the SSE stream.
import { getConnInfo, handle } from 'hono/aws-lambda'
import { createAnalyses, createApiServices, createRunStore } from './src/composition.js'
import { getApiEnv, getRunStoreEnv } from './src/lib/env.js'
import { initSentry } from './src/lib/sentry.js'
import { createApp } from './src/routes/index.js'

initSentry('api', getApiEnv())

const store = createRunStore(getRunStoreEnv())
const analyses = await createAnalyses(store, getApiEnv(), getRunStoreEnv())
// The Function URL is called directly by browsers, so the source IP is the caller's.
export const handler = handle(createApp(createApiServices(store, analyses), (c) => getConnInfo(c).remote.address))
