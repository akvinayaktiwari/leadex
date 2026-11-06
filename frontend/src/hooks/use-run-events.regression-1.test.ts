// Regression: ISSUE-001 — an unknown or expired run retried "reconnecting" forever
// Found by /qa on 2026-11-05
// Report: .gstack/qa-reports/qa-report-127-0-0-1-2026-11-05.md
import { describe, expect, it } from 'vitest'
import type { ConnectionState } from '@/types'
import { connectRunStream, type EventSourceLike } from './use-run-events'

class RefusedSource implements EventSourceLike {
  readyState = 0
  onerror: ((event: Event) => void) | null = null
  onopen: ((event: Event) => void) | null = null
  addEventListener(): void {}
  close(): void { this.readyState = 2 }
  open(): void { this.readyState = 1; this.onopen?.(new Event('open')) }
  // What the browser does when the server answers 404: the stream is closed for good.
  refuse(): void { this.readyState = 2; this.onerror?.(new Event('error')) }
}

function setup() {
  const sources: RefusedSource[] = []
  const timers: (() => void)[] = []
  const states: ConnectionState[] = []
  connectRunStream({
    url: () => 'https://stream.example/api/runs/run_missing/events', lastSeq: () => 0,
    createSource: () => { const source = new RefusedSource(); sources.push(source); return source },
    onEvent: () => {}, onConnection: (state) => states.push(state),
    schedule: (run) => { timers.push(run); return setTimeout(() => {}, 0) },
  })
  return { sources, timers, states }
}

describe('run stream that the server refuses', () => {
  // protects=a run the server refuses every time (unknown, expired or mistyped link) ends as 'unavailable' after a few tries
  // instead of showing "reconnecting" and retrying forever;
  // fails_when=the client keeps scheduling reconnects to a stream that has never opened;
  // no_claim=fake EventSource; the browser page is checked in the QA report.
  it('gives up on a stream that never opened', () => {
    const { sources, timers, states } = setup()
    for (let attempt = 0; attempt < 10 && sources.length > attempt; attempt += 1) {
      sources[attempt]!.refuse()
      timers[attempt]?.()
    }
    expect(states.at(-1)).toBe('unavailable')
    expect(sources.length).toBeLessThanOrEqual(3)
  })

  // protects=a stream that was open once keeps reconnecting after a drop, however often the server refuses for a while;
  // fails_when=the give-up rule also stops a live run that lost its connection mid-way;
  // no_claim=n/a.
  it('keeps reconnecting a stream that opened before', () => {
    const { sources, timers, states } = setup()
    sources[0]!.open()
    for (let attempt = 0; attempt < 6; attempt += 1) {
      sources[attempt]!.refuse()
      timers[attempt]!()
    }
    expect(sources).toHaveLength(7)
    expect(states).not.toContain('unavailable')
  })
})
