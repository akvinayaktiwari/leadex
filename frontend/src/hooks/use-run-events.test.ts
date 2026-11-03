import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { ConnectionState, RunEvent, RunView } from '@/types'
import { EMPTY_RUN, applyEvent } from './run-state'
import { connectRunStream, streamUrlFor, useRunEvents, type EventSourceFactory, type EventSourceLike } from './use-run-events'

const TS = '2026-11-02T10:00:00.000Z'
const note = (seq: number): RunEvent => ({ seq, ts: TS, kind: 'agent_note', text: `note ${seq}` })

class FakeSource implements EventSourceLike {
  readyState = 0
  onerror: ((event: Event) => void) | null = null
  onopen: ((event: Event) => void) | null = null
  closed = false
  private listeners = new Map<string, ((event: MessageEvent<string>) => void)[]>()
  constructor(readonly url: string) {}
  addEventListener(type: string, listener: (event: MessageEvent<string>) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
  }
  close(): void { this.closed = true; this.readyState = 2 }
  open(): void { this.readyState = 1; this.onopen?.(new Event('open')) }
  send(event: RunEvent): void { for (const listener of this.listeners.get(event.kind) ?? []) listener(new MessageEvent(event.kind, { data: JSON.stringify(event) })) }
  fail(readyState: 0 | 2): void { this.readyState = readyState; this.onerror?.(new Event('error')) }
}

function setup() {
  const sources: FakeSource[] = []
  const timers: { ms: number; run: () => void }[] = []
  let view: RunView = EMPTY_RUN
  const states: ConnectionState[] = []
  const stop = connectRunStream({
    url: (after) => streamUrlFor('https://stream.example', 'run_1', after), lastSeq: () => view.lastSeq,
    createSource: (url) => { const source = new FakeSource(url); sources.push(source); return source },
    onEvent: (event) => { view = applyEvent(view, event) }, onConnection: (state) => states.push(state),
    schedule: (run, ms) => { timers.push({ ms, run }); return setTimeout(() => {}, 0) },
  })
  return { sources, timers, states, stop, view: () => view }
}

describe('run event stream', () => {
  // protects=#6 done-when: when the connection is lost for good mid-run, the client reconnects from the last applied event and a
  // server replay does not duplicate anything; backoff grows and resets once connected;
  // fails_when=the reconnect starts from the beginning without ?after, replayed events show twice, or retries hammer the server;
  // no_claim=fake EventSource; the real browser reconnect is covered by the Playwright E2E test.
  it('reconnects from the last event after a drop, without duplicates', () => {
    const { sources, timers, view } = setup()
    sources[0]!.open()
    sources[0]!.send(note(1))
    sources[0]!.send(note(2))
    sources[0]!.fail(2)
    expect(timers.map((t) => t.ms)).toEqual([1000])
    timers[0]!.run()
    expect(sources[1]!.url).toBe('https://stream.example/api/runs/run_1/events?after=2')
    sources[1]!.fail(2)
    expect(timers.map((t) => t.ms)).toEqual([1000, 2000])
    timers[1]!.run()
    sources[2]!.open()
    sources[2]!.send(note(2))
    sources[2]!.send(note(3))
    expect(view().notes).toEqual(['note 1', 'note 2', 'note 3'])
    sources[2]!.fail(2)
    expect(timers.at(-1)?.ms).toBe(1000)
  })

  // protects=while the browser is retrying by itself (CONNECTING) no second connection is opened, and the end event closes the
  // stream for good;
  // fails_when=two streams run at once (double events), or the client keeps reconnecting after the run ended;
  // no_claim=n/a.
  it('lets the browser retry and stops at the end', () => {
    const { sources, timers, states } = setup()
    sources[0]!.open()
    sources[0]!.fail(0)
    expect(sources).toHaveLength(1)
    expect(timers).toEqual([])
    sources[0]!.send({ seq: 1, ts: TS, kind: 'end', status: 'done' })
    expect(sources[0]!.closed).toBe(true)
    sources[0]!.fail(2)
    expect(timers).toEqual([])
    expect(states).toEqual(['open', 'reconnecting', 'closed'])
  })

  // protects=leaving the page closes the stream and cancels a pending reconnect;
  // fails_when=a closed page keeps an open connection or reconnects later;
  // no_claim=n/a.
  it('stops cleanly', () => {
    const { sources, stop } = setup()
    stop()
    expect(sources[0]!.closed).toBe(true)
  })

  // protects=once the run has ended, the page does not open the stream again when its effect re-runs;
  // fails_when=a re-run effect after the end connects with ?after=<last seq>, which a finished run answers by closing and the
  // browser retries forever;
  // no_claim=n/a.
  it('does not reconnect a finished run when the effect runs again', () => {
    const sources: FakeSource[] = []
    const factory = (): EventSourceFactory => (url) => { const source = new FakeSource(url); sources.push(source); return source }
    const { result, rerender } = renderHook(({ create }) => useRunEvents('run_1', 'https://stream.example', create), { initialProps: { create: factory() } })
    act(() => sources[0]!.send({ seq: 1, ts: TS, kind: 'end', status: 'done' }))
    expect(result.current.run.end?.status).toBe('done')
    rerender({ create: factory() })
    expect(sources).toHaveLength(1)
  })
})
