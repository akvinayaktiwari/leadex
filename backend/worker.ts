// Fargate worker: long-lived SQS consumer for pipeline runs. No Lambda time limit.
import { createRunStore } from './src/composition.js'
import { createRunEngine } from './src/worker-composition.js'
import { getWorkerEnv } from './src/lib/env.js'
import { initSentry } from './src/lib/sentry.js'
import { runWorkerLoop } from './src/services/worker-service.js'

const env = getWorkerEnv()
initSentry('worker', env)

let stopping = false
const stop = (): void => {
  stopping = true
}
process.on('SIGTERM', stop)
process.on('SIGINT', stop)

const store = createRunStore(env)
const engine = createRunEngine(store, env)
await runWorkerLoop(store.queue, (job) => engine.executeRun(job), () => stopping)
