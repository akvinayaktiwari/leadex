// Starts a lead build (#12) for segments of the user's own analysis. The profile and segment filters come from the cached
// analysis, never from the client, so a request can only pick which segments and how many leads.
import { normalizeDomain } from '../lib/domain.js'
import { icpSegmentSchema, productProfileSchema } from '../lib/schemas.js'
import type {
  AnalysisCacheRepository,
  CachedAnalysis,
  Clock,
  IcpSegment,
  LeadBuildService,
  ProductProfile,
  RunEngineService,
  StartLeadBuildRequest,
  StartLeadBuildResult,
} from '../types/index.js'

export const MAX_LEADS_PER_BUILD = 500

export interface LeadBuildServiceDeps {
  runEngine: Pick<RunEngineService, 'createRun'>
  cache: AnalysisCacheRepository
  clock: Clock
  pipelineVersion: string
}

interface AnalysisResult {
  profile: ProductProfile
  segments: IcpSegment[]
}

function fromEvents(cached: CachedAnalysis): AnalysisResult | undefined {
  const artifacts = cached.events.flatMap((event) => (event.kind === 'artifact' ? [event] : []))
  const profile = productProfileSchema.safeParse(artifacts.find((event) => event.artifact === 'profile')?.data)
  if (!profile.success) return undefined
  const segments = artifacts.filter((event) => event.artifact === 'segment').flatMap((event) => {
    const parsed = icpSegmentSchema.safeParse(event.data)
    return parsed.success ? [parsed.data] : []
  })
  return { profile: profile.data, segments }
}

async function loadAnalysis(deps: LeadBuildServiceDeps, domain: string): Promise<AnalysisResult | undefined> {
  const cached = await deps.cache.get(domain, deps.pipelineVersion)
  if (!cached || Date.parse(cached.expiresAt) <= deps.clock.now().getTime()) return undefined
  return fromEvents(cached)
}

function pickSegments(available: IcpSegment[], segmentIds: string[]): IcpSegment[] | undefined {
  const wanted = [...new Set(segmentIds)]
  const picked = wanted.flatMap((id) => available.filter((segment) => segment.segmentId === id))
  return picked.length > 0 && picked.length === wanted.length ? picked : undefined
}

export function createLeadBuildService(deps: LeadBuildServiceDeps): LeadBuildService {
  return {
    async start(request: StartLeadBuildRequest): Promise<StartLeadBuildResult> {
      if (!Number.isInteger(request.leadCount) || request.leadCount < 1 || request.leadCount > MAX_LEADS_PER_BUILD) return { ok: false, code: 'invalid_lead_count' }
      const normalized = normalizeDomain(request.url)
      if (!normalized.ok) return { ok: false, code: normalized.reason }
      const analysis = await loadAnalysis(deps, normalized.domain)
      if (!analysis) return { ok: false, code: 'analysis_not_found' }
      const segments = pickSegments(analysis.segments, request.segmentIds)
      if (!segments) return { ok: false, code: 'unknown_segments' }
      const run = await deps.runEngine.createRun({
        type: 'lead_build', domain: normalized.domain, userId: request.userId,
        leadBuild: { profile: analysis.profile, segments, leadCount: request.leadCount },
      })
      return { ok: true, runId: run.runId }
    },
  }
}
