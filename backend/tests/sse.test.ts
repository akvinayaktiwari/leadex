import { describe, expect, it } from 'vitest'
import { SSE_HEARTBEAT_FRAME, formatSseEvent, parseLastEventId } from '../src/lib/sse.js'
import type { RunEvent } from '../src/types/index.js'

describe('SSE framing', () => {
  // protects=each event is one SSE frame with id = seq, event = kind and single-line JSON data;
  // fails_when=multi-line data splits a frame, the id is not the seq, or the blank-line terminator is missing;
  // no_claim=does not test how browsers parse the frame (covered by the route test reading the raw body).
  it('formats an event as one frame keyed by seq', () => {
    const event: RunEvent = { seq: 7, ts: '2026-10-21T10:00:00.000Z', kind: 'agent_note', text: 'line one\nline two' }
    const frame = formatSseEvent(event)
    expect(frame).toBe(`id: 7\nevent: agent_note\ndata: ${JSON.stringify(event)}\n\n`)
    expect(frame.split('\n').filter((line) => line.startsWith('data:'))).toHaveLength(1)
  })

  // protects=heartbeats are SSE comments that EventSource ignores;
  // fails_when=a heartbeat looks like a data event and reaches the client handler;
  // no_claim=does not prove proxies keep the connection open.
  it('uses a comment frame for heartbeats', () => {
    expect(SSE_HEARTBEAT_FRAME.startsWith(':')).toBe(true)
    expect(SSE_HEARTBEAT_FRAME.endsWith('\n\n')).toBe(true)
  })

  // protects=Last-Event-ID parsing: valid integers resume, anything else replays from the start;
  // fails_when=garbage, negatives or decimals produce NaN or skip events;
  // no_claim=does not cover ids above 15 digits (seq never gets near that).
  it('parses Last-Event-ID defensively', () => {
    expect(parseLastEventId('12')).toBe(12)
    expect(parseLastEventId(' 3 ')).toBe(3)
    expect(parseLastEventId(undefined)).toBe(0)
    expect(parseLastEventId('')).toBe(0)
    expect(parseLastEventId('-4')).toBe(0)
    expect(parseLastEventId('2.5')).toBe(0)
    expect(parseLastEventId('abc')).toBe(0)
  })
})
