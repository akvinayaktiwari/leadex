import type { PipelineRegistry } from '../types/index.js'

// Steps register here as they land: analysis (crawl, profile, competitors, segments) in #4 and #5,
// lead_build (prospect, qualify, draft, charge) in #10 and #11. A run whose type has no pipeline
// ends with `pipeline_unavailable` instead of hanging.
export const PIPELINES: PipelineRegistry = {}
