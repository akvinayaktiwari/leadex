import { Hono } from 'hono'
import { streamSSE, type SSEStreamingApi } from 'hono/streaming'
import { errorBody } from '../lib/http-errors.js'
import { SSE_HEARTBEAT_FRAME, formatSseEvent, parseLastEventId } from '../lib/sse.js'
import type { ApiServices, RunEventSink } from '../types/index.js'

function toSink(stream: SSEStreamingApi): RunEventSink {
  return {
    send: async (event) => {
      await stream.write(formatSseEvent(event))
    },
    heartbeat: async () => {
      await stream.write(SSE_HEARTBEAT_FRAME)
    },
    isClosed: () => stream.aborted || stream.closed,
  }
}

export function createRunsRoutes(services: ApiServices): Hono {
  return new Hono().get('/:runId/events', async (c) => {
    const runId = c.req.param('runId')
    // requesterUserId comes from the Cognito middleware once auth lands (#8).
    const access = await services.runStream.authorize(runId, undefined)
    if (!access.ok) return c.json(errorBody('not_found', 'Run not found'), 404)
    const afterSeq = parseLastEventId(c.req.header('Last-Event-ID') ?? c.req.query('after'))
    return streamSSE(c, async (stream) => {
      await services.runStream.stream(runId, afterSeq, toSink(stream))
    })
  })
}
