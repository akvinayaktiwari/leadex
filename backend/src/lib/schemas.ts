import { z } from 'zod'
import type { RunEvent, RunJobMessage, RunRecord } from '../types/index.js'

const runTypeSchema = z.enum(['analysis', 'lead_build'])

export const runJobMessageSchema = z.object({
  runId: z.string().min(1),
  type: runTypeSchema,
}) satisfies z.ZodType<RunJobMessage>

const stepIdSchema = z.enum(['crawl', 'profile', 'competitors', 'segments', 'prospect', 'qualify', 'draft', 'charge'])

const runErrorSchema = z.object({ code: z.string().min(1), message: z.string() })

export const runRecordSchema = z.object({
  runId: z.string().min(1),
  type: runTypeSchema,
  domain: z.string().min(1),
  userId: z.string().min(1).optional(),
  status: z.enum(['queued', 'running', 'done', 'failed']),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  error: runErrorSchema.optional(),
}) satisfies z.ZodType<RunRecord>

const eventBase = { seq: z.int().positive(), ts: z.string().min(1) }

export const runEventSchema = z.discriminatedUnion('kind', [
  z.object({
    ...eventBase,
    kind: z.literal('step'),
    step: stepIdSchema,
    state: z.enum(['started', 'completed', 'failed']),
    label: z.string(),
    durationMs: z.number().nonnegative().optional(),
  }),
  z.object({
    ...eventBase,
    kind: z.literal('artifact'),
    step: stepIdSchema,
    artifact: z.enum(['profile', 'competitor', 'segment', 'lead_batch']),
    data: z.unknown(),
  }),
  z.object({ ...eventBase, kind: z.literal('agent_note'), text: z.string() }),
  z.object({
    ...eventBase,
    kind: z.literal('end'),
    status: z.enum(['done', 'failed']),
    error: runErrorSchema.optional(),
  }),
]) satisfies z.ZodType<RunEvent>
