// Stream Lambda (Function URL, RESPONSE_STREAM invoke mode). Serves the run-event SSE route.
// Kept in its own bundle because streamHandle() calls awslambda.streamifyResponse at load time,
// which only exists in the RESPONSE_STREAM runtime.
import { getConnInfo, streamHandle } from 'hono/aws-lambda'
import { createApiServices, createRunStore } from './src/composition.js'
import { DISABLED_ANALYSIS_SERVICE } from './src/services/analysis-service.js'
import { getApiEnv, getRunStoreEnv } from './src/lib/env.js'
import { initSentry } from './src/lib/sentry.js'
import { createApp } from './src/routes/index.js'

initSentry('stream', getApiEnv())

// Only the event stream is served here; analyses start on the API Lambda.
export const streamingHandler = streamHandle(createApp(createApiServices(createRunStore(getRunStoreEnv()), DISABLED_ANALYSIS_SERVICE), (c) => getConnInfo(c).remote.address))
