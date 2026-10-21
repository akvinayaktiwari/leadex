import { logError, logInfo } from '../lib/logger.js'
import { runJobMessageSchema } from '../lib/schemas.js'
import { captureError } from '../lib/sentry.js'
import type { QueueMessage, RunJobHandler, RunJobMessage, RunQueueRepository } from '../types/index.js'

const RECEIVE_BATCH_SIZE = 1
const RECEIVE_WAIT_SECONDS = 20
const RECEIVE_ERROR_BACKOFF_MS = 5_000

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

function parseJob(message: QueueMessage): RunJobMessage | undefined {
  try {
    const result = runJobMessageSchema.safeParse(JSON.parse(message.body))
    return result.success ? result.data : undefined
  } catch (error) {
    logError('queue message is not valid JSON', error)
    return undefined
  }
}

async function processMessage(
  queue: RunQueueRepository,
  message: QueueMessage,
  handleJob: RunJobHandler,
): Promise<void> {
  const job = parseJob(message)
  if (!job) {
    // A malformed message can never succeed; drop it instead of retrying into the DLQ.
    logInfo('dropping malformed run job message')
    await queue.remove(message.receiptHandle)
    return
  }
  try {
    await handleJob(job)
    await queue.remove(message.receiptHandle)
  } catch (error) {
    // Leave the message on the queue: SQS redelivers it, then moves it to the DLQ.
    logError('run job failed', error, { runId: job.runId })
    captureError(error, { runId: job.runId })
  }
}

export async function processNextBatch(
  queue: RunQueueRepository,
  handleJob: RunJobHandler,
): Promise<number> {
  const messages = await queue.receive(RECEIVE_BATCH_SIZE, RECEIVE_WAIT_SECONDS)
  for (const message of messages) {
    await processMessage(queue, message, handleJob)
  }
  return messages.length
}

export async function runWorkerLoop(
  queue: RunQueueRepository,
  handleJob: RunJobHandler,
  shouldStop: () => boolean,
  pause: (ms: number) => Promise<void> = sleep,
): Promise<void> {
  logInfo('worker started')
  while (!shouldStop()) {
    try {
      await processNextBatch(queue, handleJob)
    } catch (error) {
      // Back off so an unreachable queue doesn't spin the loop and flood logs.
      logError('queue receive failed', error)
      captureError(error)
      await pause(RECEIVE_ERROR_BACKOFF_MS)
    }
  }
  logInfo('worker stopped')
}
