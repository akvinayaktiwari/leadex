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

const marketCodeSchema = z.string().regex(/^([A-Z]{2}|GLOBAL)$/, 'Use an ISO-3166 alpha-2 code (e.g. "IN") or "GLOBAL"')

// What the model returns for the profile step; the domain is added by the step, never by the model.
export const productProfileDraftSchema = z.object({
  name: z.string().min(1).max(80),
  oneLiner: z.string().min(1).max(160),
  valueProps: z.array(z.string().min(1).max(200)).min(3).max(6),
  category: z.string().min(1).max(80),
  pricingSignals: z.array(z.string().min(1).max(120)).max(6),
  servedMarkets: z.array(marketCodeSchema).min(1).max(15),
})

export type ProductProfileDraft = z.infer<typeof productProfileDraftSchema>
