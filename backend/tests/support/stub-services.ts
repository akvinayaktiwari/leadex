import type { AnalysisService } from '../../src/types/index.js'

// For route tests that don't exercise analyses.
export const DISABLED_ANALYSES: AnalysisService = { start: async () => ({ ok: false, code: 'analyses_disabled' }) }
