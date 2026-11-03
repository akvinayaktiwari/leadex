// Pure state for one analysis run: applies run events in order, at most once each.
import type { Competitor, IcpSegment, ProductProfile, RunEvent, RunView, StepView } from '@/types'

export const EMPTY_RUN: RunView = { lastSeq: 0, steps: [], notes: [], competitors: [], segments: [] }

function withStep(steps: StepView[], event: Extract<RunEvent, { kind: 'step' }>): StepView[] {
  const view: StepView = { step: event.step, label: event.label, state: event.state, ...(event.durationMs !== undefined ? { durationMs: event.durationMs } : {}) }
  const index = steps.findIndex((step) => step.step === event.step)
  return index === -1 ? [...steps, view] : steps.map((step, i) => (i === index ? view : step))
}

// Artifacts are trusted as the backend's validated shapes; identity fields keep a re-sent card from appearing twice.
function withArtifact(run: RunView, event: Extract<RunEvent, { kind: 'artifact' }>): RunView {
  if (event.artifact === 'profile') return { ...run, profile: event.data as ProductProfile }
  if (event.artifact === 'competitor') {
    const competitor = event.data as Competitor
    return run.competitors.some((c) => c.domain === competitor.domain) ? run : { ...run, competitors: [...run.competitors, competitor] }
  }
  if (event.artifact === 'segment') {
    const segment = event.data as IcpSegment
    return run.segments.some((s) => s.segmentId === segment.segmentId) ? run : { ...run, segments: [...run.segments, segment] }
  }
  return run
}

export function applyEvent(run: RunView, event: RunEvent): RunView {
  if (event.seq <= run.lastSeq) return run
  const next = { ...run, lastSeq: event.seq }
  switch (event.kind) {
    case 'step':
      return { ...next, steps: withStep(next.steps, event) }
    case 'artifact':
      return withArtifact(next, event)
    case 'agent_note':
      return { ...next, notes: [...next.notes, event.text] }
    case 'end':
      return { ...next, end: { status: event.status, ...(event.error ? { error: event.error } : {}) } }
  }
}

// Parses one SSE data payload; undefined for anything that isn't a run event (never throws into the UI).
export function parseRunEvent(data: string): RunEvent | undefined {
  try {
    const value = JSON.parse(data) as Partial<RunEvent>
    return typeof value.seq === 'number' && typeof value.kind === 'string' ? (value as RunEvent) : undefined
  } catch {
    return undefined
  }
}
