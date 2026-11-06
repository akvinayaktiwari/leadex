import { z } from 'zod'
import { INDUSTRIES } from '../config/industries.js'
import type { CompanyFilters, IcpSegment, LeadBuildInput, ProductProfile, RunEvent, RunJobMessage, RunRecord } from '../types/index.js'

const runTypeSchema = z.enum(['analysis', 'lead_build'])

export const runJobMessageSchema = z.object({
  runId: z.string().min(1),
  type: runTypeSchema,
}) satisfies z.ZodType<RunJobMessage>

const stepIdSchema = z.enum(['crawl', 'profile', 'competitors', 'segments', 'prospect', 'qualify', 'draft', 'charge'])

const runErrorSchema = z.object({ code: z.string().min(1), message: z.string() })

const companyFiltersSchema = z.object({
  industries: z.array(z.string()), employeeMin: z.number(), employeeMax: z.number(),
  countries: z.array(z.string()), keywords: z.array(z.string()), technologies: z.array(z.string()),
}) satisfies z.ZodType<CompanyFilters>

export const productProfileSchema = z.object({
  domain: z.string().min(1), name: z.string(), oneLiner: z.string(), valueProps: z.array(z.string()), category: z.string(),
  pricingSignals: z.array(z.string()), servedMarkets: z.array(z.string()), crawledAt: z.string(),
  claims: z.array(z.object({ field: z.enum(['oneLiner', 'category', 'valueProp', 'pricingSignal']), text: z.string(), sourceUrl: z.string() })),
}) satisfies z.ZodType<ProductProfile>

export const icpSegmentSchema = z.object({
  segmentId: z.string().min(1), name: z.string(), useCase: z.string(), pain: z.string(), criteria: z.array(z.string()),
  buyerTitles: z.array(z.string()), filters: companyFiltersSchema, sharePct: z.number(),
}) satisfies z.ZodType<IcpSegment>

const leadBuildInputSchema = z.object({
  profile: productProfileSchema, segments: z.array(icpSegmentSchema).min(1), leadCount: z.int().positive(),
}) satisfies z.ZodType<LeadBuildInput>

export const runRecordSchema = z.object({
  runId: z.string().min(1),
  type: runTypeSchema,
  domain: z.string().min(1),
  userId: z.string().min(1).optional(),
  status: z.enum(['queued', 'running', 'done', 'failed']),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  error: runErrorSchema.optional(),
  leadBuild: leadBuildInputSchema.optional(),
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
// Each claim names the crawled page it came from; the step keeps the URL only if it is one of the pages it sent.
const sourcedClaim = z.object({ text: z.string().min(1).max(200), sourceUrl: z.string().max(2000) })

export const productProfileDraftSchema = z.object({
  name: z.string().min(1).max(80),
  oneLiner: z.object({ text: z.string().min(1).max(160), sourceUrl: z.string().max(2000) }),
  valueProps: z.array(sourcedClaim).min(3).max(6),
  category: z.object({ text: z.string().min(1).max(80), sourceUrl: z.string().max(2000) }),
  pricingSignals: z.array(sourcedClaim.extend({ text: z.string().min(1).max(120) })).max(6),
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

// What the model returns for the competitors step (#5). Countries are checked against each competitor's own site.
export const competitorsDraftSchema = z.object({
  competitors: z.array(z.object({
    domain: z.string().min(3).max(253),
    name: z.string().min(1).max(80),
    reason: z.string().min(1).max(160),
    hqCountry: z.string().regex(/^([A-Z]{2}|UNKNOWN)$/, 'Use an ISO-3166 alpha-2 code or "UNKNOWN"'),
  })).max(20),
})

export type CompetitorsDraft = z.infer<typeof competitorsDraftSchema>

// What the model returns for the segments step (#5). Shares are rescaled to sum to 100 after validation.
export const segmentsDraftSchema = z.object({
  segments: z.array(z.object({
    name: z.string().min(1).max(60),
    useCase: z.string().min(1).max(200),
    pain: z.string().min(1).max(200),
    criteria: z.array(z.string().min(1).max(120)).min(2).max(4),
    buyerTitles: z.array(z.string().min(1).max(60)).min(2).max(6),
    industries: z.array(z.enum(INDUSTRIES)).min(1).max(4),
    // 0 means "no limit" for employeeMax.
    employeeMin: z.number().int().min(0).max(1_000_000),
    employeeMax: z.number().int().min(0).max(1_000_000),
    countries: z.array(z.string().regex(/^[A-Z]{2}$/)).max(15),
    keywords: z.array(z.string().min(1).max(40)).max(8),
    technologies: z.array(z.string().min(1).max(40)).max(5),
    sharePct: z.number().min(0).max(100),
  })).min(4).max(6),
})

export type SegmentsDraft = z.infer<typeof segmentsDraftSchema>

// What the model returns when qualifying a batch of lead candidates (#12). Ids are the ones the step sent.
export const leadFitDraftSchema = z.object({
  leads: z.array(z.object({
    id: z.string().min(1),
    fitScore: z.int().min(0).max(100),
    // One sentence on why this seller's offer fits this company, from the fields given only.
    angle: z.string().max(300),
    // True when no honest angle exists, whatever the score.
    skip: z.boolean(),
  })),
})
export type LeadFitDraft = z.infer<typeof leadFitDraftSchema>
