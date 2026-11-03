import { describe, expect, it } from 'vitest'
import type { RunEvent } from '@/types'
import { EMPTY_RUN, applyEvent, parseRunEvent } from './run-state'

const TS = '2026-11-02T10:00:00.000Z'
const competitor = { domain: 'xionmedia.in', name: 'Xion', reason: 'r', country: 'IN', countrySource: 'cctld' }
const segment = (id: string) => ({ segmentId: id, name: id, useCase: 'u', pain: 'p', criteria: [], buyerTitles: [], sharePct: 50, filters: { industries: [], employeeMin: 0, employeeMax: 0, countries: [], keywords: [], technologies: [] } })

const EVENTS: RunEvent[] = [
  { seq: 1, ts: TS, kind: 'step', step: 'crawl', state: 'started', label: 'Reading the website' },
  { seq: 2, ts: TS, kind: 'agent_note', text: 'Read 4 pages' },
  { seq: 3, ts: TS, kind: 'step', step: 'crawl', state: 'completed', label: 'Reading the website', durationMs: 900 },
  { seq: 4, ts: TS, kind: 'artifact', step: 'competitors', artifact: 'competitor', data: competitor },
  { seq: 5, ts: TS, kind: 'artifact', step: 'segments', artifact: 'segment', data: segment('a') },
  { seq: 6, ts: TS, kind: 'artifact', step: 'segments', artifact: 'segment', data: segment('b') },
  { seq: 7, ts: TS, kind: 'end', status: 'done' },
]

const replay = (events: RunEvent[]) => events.reduce(applyEvent, EMPTY_RUN)

describe('run state', () => {
  // protects=events build the view in order: one row per step updated in place, notes, competitor and segment cards, the end;
  // fails_when=a step appears twice (started + completed rows) or a card is missing;
  // no_claim=n/a.
  it('builds the run view from events', () => {
    const view = replay(EVENTS)
    expect(view.steps).toEqual([{ step: 'crawl', label: 'Reading the website', state: 'completed', durationMs: 900 }])
    expect(view.notes).toEqual(['Read 4 pages'])
    expect(view.competitors.map((c) => c.domain)).toEqual(['xionmedia.in'])
    expect(view.segments.map((s) => s.segmentId)).toEqual(['a', 'b'])
    expect(view.end).toEqual({ status: 'done' })
    expect(view.lastSeq).toBe(7)
  })

  // protects=#6 done-when: after a reconnect, events already applied are ignored, so no card or note is duplicated, even if the
  // server re-sends from an earlier seq;
  // fails_when=a dropped connection that replays events 3-6 shows two competitor cards or two notes;
  // no_claim=the browser-level reconnect is covered by the Playwright E2E test.
  it('ignores events it has already applied', () => {
    const view = replay([...EVENTS.slice(0, 5), ...EVENTS.slice(1, 6), ...EVENTS.slice(5)])
    expect(view).toEqual(replay(EVENTS))
  })

  // protects=SSE payloads that aren't run events are ignored instead of crashing the page;
  // fails_when=a malformed frame throws inside the event handler;
  // no_claim=n/a.
  it('parses only valid run events', () => {
    expect(parseRunEvent(JSON.stringify(EVENTS[0]))).toEqual(EVENTS[0])
    expect(parseRunEvent('{broken')).toBeUndefined()
    expect(parseRunEvent('{"hello":1}')).toBeUndefined()
  })
})
