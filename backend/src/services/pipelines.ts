import type { AnalysisState, Clock, LlmModels, LlmRepository, PipelineRegistry, SiteFetchRepository } from '../types/index.js'
import { createCrawlStep } from './pipeline-steps/crawl-step.js'
import { createProfileStep } from './pipeline-steps/profile-step.js'

export interface PipelineDeps {
  siteFetch: SiteFetchRepository
  llm: LlmRepository
  models: LlmModels
  clock: Clock
}

// competitors and segments join the analysis pipeline in #5; lead_build (prospect, qualify, draft, charge)
// lands in #10 and #11. A run whose type has no pipeline ends with `pipeline_unavailable` instead of hanging.
export function createPipelineRegistry(deps: PipelineDeps): PipelineRegistry {
  return {
    analysis: () => {
      const state: AnalysisState = {}
      return [createCrawlStep(deps, state), createProfileStep(deps, state)]
    },
  }
}
