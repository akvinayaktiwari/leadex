import type { AnalysisState, Clock, LeadBuildState, LeadDataService, LlmModels, LlmRepository, PipelineRegistry, SiteFetchRepository } from '../types/index.js'
import { createCompetitorsStep } from './pipeline-steps/competitors-step.js'
import { createCrawlStep } from './pipeline-steps/crawl-step.js'
import { createProfileStep } from './pipeline-steps/profile-step.js'
import { createProspectStep } from './pipeline-steps/prospect-step.js'
import { createQualifyStep } from './pipeline-steps/qualify-step.js'
import { createSegmentsStep } from './pipeline-steps/segments-step.js'

export interface PipelineDeps {
  siteFetch: SiteFetchRepository
  llm: LlmRepository
  models: LlmModels
  clock: Clock
  // Leadex Data (ClickHouse). Without it the worker runs analyses only, and lead builds end with pipeline_unavailable.
  leadData?: LeadDataService | undefined
}

// The free analysis: crawl, profile, competitors, segments. A lead build: prospect, qualify (#12); draft and charge
// land in #13. A run whose type has no pipeline ends with `pipeline_unavailable` instead of hanging.
export function createPipelineRegistry(deps: PipelineDeps): PipelineRegistry {
  const { leadData } = deps
  return {
    analysis: () => {
      const state: AnalysisState = {}
      return [createCrawlStep(deps, state), createProfileStep(deps, state), createCompetitorsStep(deps, state), createSegmentsStep(deps, state)]
    },
    ...(leadData ? {
      lead_build: (run) => {
        const state: LeadBuildState = {}
        return [createProspectStep({ leadData }, run.leadBuild, state), createQualifyStep(deps, run.leadBuild, state)]
      },
    } : {}),
  }
}
