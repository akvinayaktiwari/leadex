import type { AnalysisService, ClientIpReader } from '../../src/types/index.js'

// For route tests that don't exercise analyses.
export const DISABLED_ANALYSES: AnalysisService = { start: async () => ({ ok: false, code: 'analyses_disabled' }) }

// Route tests have no real connection; analyses count them under 'unknown'.
export const NO_CLIENT_IP: ClientIpReader = () => undefined
