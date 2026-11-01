import { z } from 'zod'
import { INDUSTRIES } from '../config/industries.js'
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

// What the model returns for a company profile (#22). Every field names the crawled page it came from;
// the profiler rejects a field whose sourceUrl is not one of the pages it sent. Empty string / 0 mean "not stated".
const sourceUrlSchema = z.string().max(2000)
const sourced = <T extends z.ZodType>(value: T) => z.object({ value, sourceUrl: sourceUrlSchema })

export const companyProfileDraftSchema = z.object({
  isBusiness: z.boolean(),
  notBusinessReason: z.string().max(200),
  name: sourced(z.string().max(120)),
  legalName: sourced(z.string().max(160)),
  description: sourced(z.string().max(300)),
  industry: sourced(z.enum(INDUSTRIES)),
  keywords: sourced(z.array(z.string().min(1).max(40)).max(8)),
  employeeCount: z.object({ value: z.number().int().min(0).max(5_000_000), sourceUrl: sourceUrlSchema, quote: z.string().max(200) }),
  location: z.object({
    country: z.string().regex(/^([A-Z]{2}|UNKNOWN)$/, 'Use an ISO-3166 alpha-2 code or "UNKNOWN"'),
    region: z.string().max(80),
    city: z.string().max(80),
    sourceUrl: sourceUrlSchema,
    quote: z.string().max(200),
  }),
  servedMarkets: sourced(z.array(marketCodeSchema).max(15)),
})

export type CompanyProfileDraft = z.infer<typeof companyProfileDraftSchema>

// What the model returns for people on a company's own pages (#23). The quote must contain the name and the title.
export const peopleDraftSchema = z.object({
  people: z.array(z.object({
    name: z.string().min(1).max(80),
    title: z.string().max(120),
    isCurrentStaff: z.boolean(),
    sourceUrl: z.string().max(2000),
    quote: z.string().max(300),
  })).max(40),
})

export type PeopleDraft = z.infer<typeof peopleDraftSchema>
