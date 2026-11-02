import type { AnalysisState, Clock, LlmModels, LlmRepository, PipelineRegistry, SiteFetchRepository } from '../types/index.js'
import { createCompetitorsStep } from './pipeline-steps/competitors-step.js'
import { createCrawlStep } from './pipeline-steps/crawl-step.js'
import { createProfileStep } from './pipeline-steps/profile-step.js'
import { createSegmentsStep } from './pipeline-steps/segments-step.js'

export interface PipelineDeps {
  siteFetch: SiteFetchRepository
  llm: LlmRepository
  models: LlmModels
  clock: Clock
}

// The free analysis: crawl, profile, competitors, segments. lead_build (prospect, qualify, draft, charge) lands in
// #12 and #13. A run whose type has no pipeline ends with `pipeline_unavailable` instead of hanging.
export function createPipelineRegistry(deps: PipelineDeps): PipelineRegistry {
  return {
    analysis: () => {
      const state: AnalysisState = {}
      return [createCrawlStep(deps, state), createProfileStep(deps, state), createCompetitorsStep(deps, state), createSegmentsStep(deps, state)]
    },
  }
}
