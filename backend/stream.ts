// Stream Lambda (Function URL, RESPONSE_STREAM invoke mode). Serves the run-event SSE route.
// Kept in its own bundle because streamHandle() calls awslambda.streamifyResponse at load time,
// which only exists in the RESPONSE_STREAM runtime.
import { streamHandle } from 'hono/aws-lambda'
import { createApiServices, createRunStore } from './src/composition.js'
import { getApiEnv, getRunStoreEnv } from './src/lib/env.js'
import { initSentry } from './src/lib/sentry.js'
import { createApp } from './src/routes/index.js'

initSentry('stream', getApiEnv())

export const streamingHandler = streamHandle(createApp(createApiServices(createRunStore(getRunStoreEnv()))))
