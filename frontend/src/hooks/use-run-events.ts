'use client'

// Live run events over SSE. The browser's EventSource resumes after a drop with Last-Event-ID; if it gives up (CLOSED),
// this hook reconnects with ?after=<last seq> and backs off. Events are applied once each (run-state), so replays are harmless.
import { useEffect, useReducer, useRef, useState } from 'react'
import type { ConnectionState, RunEvent, RunView } from '@/types'
import { EMPTY_RUN, applyEvent, parseRunEvent } from './run-state'

const EVENT_KINDS = ['step', 'artifact', 'agent_note', 'end'] as const
const MAX_BACKOFF_MS = 10_000

export interface EventSourceLike {
  readyState: number
  addEventListener(type: string, listener: (event: MessageEvent<string>) => void): void
  onerror: ((event: Event) => void) | null
  onopen: ((event: Event) => void) | null
  close(): void
}

export type EventSourceFactory = (url: string) => EventSourceLike

const CLOSED = 2

const browserEventSource: EventSourceFactory = (url) => new EventSource(url, { withCredentials: true })

export function streamUrlFor(base: string, runId: string, afterSeq: number): string {
  const url = `${base}/api/runs/${encodeURIComponent(runId)}/events`
  return afterSeq > 0 ? `${url}?after=${afterSeq}` : url
}

interface Connection {
  source?: EventSourceLike
  retryTimer?: ReturnType<typeof setTimeout>
  attempts: number
  stopped: boolean
}

export interface RunStreamOptions {
  url: (afterSeq: number) => string
  lastSeq: () => number
  createSource: EventSourceFactory
  onEvent: (event: RunEvent) => void
  onConnection: (state: ConnectionState) => void
  // Injectable for tests.
  schedule?: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>
}

// Opens the stream and keeps it alive until the run ends; returns a function that stops it.
export function connectRunStream(options: RunStreamOptions): () => void {
  const schedule = options.schedule ?? setTimeout
  const state: Connection = { attempts: 0, stopped: false }
  const handle = (message: MessageEvent<string>): void => {
    const event = parseRunEvent(message.data)
    if (!event) return
    options.onEvent(event)
    if (event.kind !== 'end') return
    state.stopped = true
    state.source?.close()
    options.onConnection('closed')
  }
  const open = (): void => {
    const source = options.createSource(options.url(options.lastSeq()))
    state.source = source
    for (const kind of EVENT_KINDS) source.addEventListener(kind, handle)
    source.onopen = () => {
      state.attempts = 0
      options.onConnection('open')
    }
    source.onerror = () => {
      if (state.stopped) return
      options.onConnection('reconnecting')
      // CONNECTING: the browser retries by itself. CLOSED: it gave up, so reconnect from the last applied event.
      if (source.readyState !== CLOSED) return
      source.close()
      state.retryTimer = schedule(open, Math.min(MAX_BACKOFF_MS, 1000 * 2 ** state.attempts))
      state.attempts += 1
    }
  }
  open()
  return () => {
    state.stopped = true
    if (state.retryTimer) clearTimeout(state.retryTimer)
    state.source?.close()
  }
}

export function useRunEvents(runId: string | undefined, streamBase: string, createSource?: EventSourceFactory): { run: RunView; connection: ConnectionState } {
  const [run, dispatch] = useReducer(applyEvent, EMPTY_RUN)
  const [connection, setConnection] = useState<ConnectionState>('connecting')
  const lastSeq = useRef(0)
  lastSeq.current = run.lastSeq
  const ended = useRef(false)
  ended.current = run.end !== undefined
  useEffect(() => {
    // If a dependency changes after the end, don't reopen: a finished run's stream sends nothing and closes, which the
    // browser would retry forever.
    if (!runId || ended.current) return undefined
    return connectRunStream({
      url: (afterSeq) => streamUrlFor(streamBase, runId, afterSeq), lastSeq: () => lastSeq.current,
      // The default is chosen here, not as a parameter default: a minified build inlines it as a new function on every
      // render, which made this effect close and reopen the stream on each event.
      createSource: createSource ?? browserEventSource, onEvent: dispatch, onConnection: setConnection,
    })
  }, [runId, streamBase, createSource])
  return { run, connection }
}
