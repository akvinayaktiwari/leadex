import type { RunEvent } from '../types/index.js'

export const SSE_HEARTBEAT_FRAME = ': heartbeat\n\n'

// One frame per event. JSON.stringify never emits raw newlines, so `data:` stays on one line.
export function formatSseEvent(event: RunEvent): string {
  return `id: ${event.seq}\nevent: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`
}

// Last-Event-ID (or ?after=) → the last seq the client already has. Anything invalid means "from the start".
export function parseLastEventId(raw: string | undefined): number {
  if (raw === undefined || !/^\d{1,15}$/.test(raw.trim())) return 0
  return Number(raw.trim())
}
