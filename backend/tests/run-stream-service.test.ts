import { describe, expect, it } from 'vitest'
import { createRunStreamService } from '../src/services/run-stream-service.js'
import type { RunEvent, RunEventSink, RunStreamOptions } from '../src/types/index.js'
import { manualClock, memoryEvents, memoryRuns, sampleRun, type ManualClock, type MemoryEvents } from './support/in-memory-run-store.js'

const OPTIONS: RunStreamOptions = { pollMs: 500, heartbeatMs: 1_000, maxDurationMs: 2_000, pageSize: 2 }

function note(seq: number): RunEvent {
  return { seq, ts: '2026-10-21T10:00:00.000Z', kind: 'agent_note', text: `note ${seq}` }
}

function end(seq: number): RunEvent {
  return { seq, ts: '2026-10-21T10:00:00.000Z', kind: 'end', status: 'done' }
}

interface RecordingSink extends RunEventSink {
  received: number[]
  heartbeats: number
}

// closeAfter simulates the client dropping the connection after n events.
function recordingSink(closeAfter = Number.POSITIVE_INFINITY): RecordingSink {
  const sink: RecordingSink = {
    received: [],
    heartbeats: 0,
    send: async (event) => void sink.received.push(event.seq),
    heartbeat: async () => void sink.heartbeats++,
    isClosed: () => sink.received.length >= closeAfter,
  }
  return sink
}

async function setup(status: 'running' | 'done', events: RunEvent[], onSleep?: (clock: ManualClock, store: MemoryEvents) => Promise<void>) {
  const runs = memoryRuns()
  const store = memoryEvents()
  const clock = manualClock()
  await runs.create(sampleRun({ status }))
  for (const event of events) await store.append('run_1', event)
  const sleep = async (ms: number): Promise<void> => {
    clock.advance(ms)
    await onSleep?.(clock, store)
  }
  return createRunStreamService({ runs, events: store, clock, sleep, options: OPTIONS })
}

describe('run event stream', () => {
  // protects=acceptance criterion 3: after a disconnect, reconnecting with Last-Event-ID n delivers exactly seq > n;
  // fails_when=the resumed stream repeats event n, skips n+1, or never ends after the end event;
  // no_claim=uses in-memory storage; DynamoDB query ordering is covered by the repository test.
  it('resumes after a disconnect with no gaps and no duplicates', async () => {
    const service = await setup('done', [note(1), note(2), note(3), note(4), note(5), end(6)])
    const first = recordingSink(3)
    expect(await service.stream('run_1', 0, first)).toBe('client_closed')
    const lastSeen = first.received.at(-1) ?? 0

    const second = recordingSink()
    expect(await service.stream('run_1', lastSeen, second)).toBe('ended')
    expect([...first.received, ...second.received]).toEqual([1, 2, 3, 4, 5, 6])
  })

  // protects=events appended while a client is connected are delivered live, in order, and the stream closes on end;
  // fails_when=the stream only replays what existed at connect time, or keeps polling after end;
  // no_claim=does not measure the 500 ms polling latency against a real clock.
  it('tails events written while connected', async () => {
    let next = 2
    const service = await setup('running', [note(1)], async (_clock, store) => {
      if (next <= 3) await store.append('run_1', next === 3 ? end(next) : note(next))
      next += 1
    })
    const sink = recordingSink()
    expect(await service.stream('run_1', 0, sink)).toBe('ended')
    expect(sink.received).toEqual([1, 2, 3])
  })

  // protects=an idle stream sends heartbeats and closes at maxDurationMs so the Lambda never hits its hard limit;
  // fails_when=no heartbeat is sent while idle, or the stream runs past its maximum duration;
  // no_claim=uses scaled-down timings (1 s heartbeat, 2 s max), not the production 15 s / 840 s.
  it('sends heartbeats while idle and stops at the max duration', async () => {
    const service = await setup('running', [])
    const sink = recordingSink()
    expect(await service.stream('run_1', 0, sink)).toBe('timeout')
    expect(sink.received).toEqual([])
    expect(sink.heartbeats).toBe(1)
  })

  // protects=a client resuming after it already received the end event is closed immediately;
  // fails_when=a reconnect after a finished run waits idle until the max duration;
  // no_claim=does not test a run that finishes without an end event (the engine always writes one).
  it('closes at once when resuming a finished run past its end', async () => {
    const service = await setup('done', [note(1), end(2)])
    const sink = recordingSink()
    expect(await service.stream('run_1', 2, sink)).toBe('ended')
    expect(sink.received).toEqual([])
  })

  // protects=lead_build streams are visible only to their owner; unknown runs are not found;
  // fails_when=an anonymous or different user can read another user's paid lead build;
  // no_claim=requester identity comes from Cognito middleware, which lands in #8.
  it('authorizes lead builds by owner only', async () => {
    const runs = memoryRuns()
    await runs.create(sampleRun({ runId: 'run_lb', type: 'lead_build', userId: 'user_a' }))
    await runs.create(sampleRun({ runId: 'run_an' }))
    const service = createRunStreamService({ runs, events: memoryEvents(), clock: manualClock(), sleep: async () => {}, options: OPTIONS })
    expect((await service.authorize('missing', undefined)).ok).toBe(false)
    expect((await service.authorize('run_lb', undefined)).ok).toBe(false)
    expect((await service.authorize('run_lb', 'user_b')).ok).toBe(false)
    expect((await service.authorize('run_lb', 'user_a')).ok).toBe(true)
    expect((await service.authorize('run_an', undefined)).ok).toBe(true)
  })
})
