import { describe, expect, it } from 'vitest'
import { processNextBatch, runWorkerLoop } from '../src/services/worker-service.js'
import type { QueueMessage, RunJobMessage, RunQueueRepository } from '../src/types/index.js'

interface FakeQueue extends RunQueueRepository {
  removed: string[]
}

function fakeQueue(messages: QueueMessage[]): FakeQueue {
  const removed: string[] = []
  return {
    removed,
    async receive(): Promise<QueueMessage[]> {
      return messages
    },
    async remove(receiptHandle: string): Promise<void> {
      removed.push(receiptHandle)
    },
  }
}

describe('worker message handling', () => {
  // protects=a valid job is handled once and then deleted from the queue;
  // fails_when=job not handled, or deleted before the handler finished;
  // no_claim=does not exercise real SQS long polling.
  it('handles and deletes a valid job', async () => {
    const handled: RunJobMessage[] = []
    const queue = fakeQueue([{ receiptHandle: 'r1', body: JSON.stringify({ runId: 'run_1', type: 'analysis' }) }])
    await processNextBatch(queue, async (job) => {
      handled.push(job)
    })
    expect(handled).toEqual([{ runId: 'run_1', type: 'analysis' }])
    expect(queue.removed).toEqual(['r1'])
  })

  // protects=malformed messages are dropped, never handled;
  // fails_when=bad JSON or wrong shape reaches the handler or loops forever;
  // no_claim=does not check DLQ configuration (covered by infra tests).
  it('drops malformed messages without handling them', async () => {
    let calls = 0
    const queue = fakeQueue([
      { receiptHandle: 'bad-json', body: '{not json' },
      { receiptHandle: 'bad-shape', body: JSON.stringify({ runId: 'x', type: 'nope' }) },
    ])
    await processNextBatch(queue, async () => {
      calls += 1
    })
    expect(calls).toBe(0)
    expect(queue.removed).toEqual(['bad-json', 'bad-shape'])
  })

  // protects=a failing job stays on the queue so SQS retries it, then sends it to the DLQ;
  // fails_when=a failed job is deleted (silently lost);
  // no_claim=does not prove redelivery timing.
  it('keeps a failed job on the queue', async () => {
    const queue = fakeQueue([{ receiptHandle: 'r2', body: JSON.stringify({ runId: 'run_2', type: 'lead_build' }) }])
    await processNextBatch(queue, async () => {
      throw new Error('boom')
    })
    expect(queue.removed).toEqual([])
  })

  // protects=the loop backs off after a receive failure instead of spinning;
  // fails_when=an unreachable queue causes a tight retry loop with no pause;
  // no_claim=does not assert the real 5 s delay (pause is injected).
  it('backs off after a queue receive failure', async () => {
    const pauses: number[] = []
    let iterations = 0
    const failingQueue: RunQueueRepository = {
      async receive(): Promise<QueueMessage[]> {
        throw new Error('queue unreachable')
      },
      async remove(): Promise<void> {},
    }
    await runWorkerLoop(
      failingQueue,
      async () => {},
      () => iterations++ >= 2,
      async (ms) => {
        pauses.push(ms)
      },
    )
    expect(pauses).toEqual([5_000, 5_000])
  })
})
