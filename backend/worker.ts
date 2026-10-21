// Fargate worker: long-lived SQS consumer for pipeline runs. No Lambda time limit.
import { getWorkerEnv } from './src/lib/env.js'
import { initSentry } from './src/lib/sentry.js'
import { createSqsClient } from './src/lib/sqs-client.js'
import { createRunQueueRepository } from './src/repositories/run-queue-repository.js'
import { handleRunJob } from './src/services/run-job-service.js'
import { runWorkerLoop } from './src/services/worker-service.js'

const env = getWorkerEnv()
initSentry('worker', env)

let stopping = false
const stop = (): void => {
  stopping = true
}
process.on('SIGTERM', stop)
process.on('SIGINT', stop)

const queue = createRunQueueRepository(createSqsClient(env.AWS_REGION), env.SQS_RUNS_QUEUE_URL)
await runWorkerLoop(queue, handleRunJob, () => stopping)
