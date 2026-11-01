import { App } from 'aws-cdk-lib'
import { LeadexStack, type Stage } from '../lib/leadex-stack'

const STAGES: Stage[] = ['dev', 'staging', 'prod']

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required environment variable for deploy: ${name}`)
  return value
}

function readStage(): Stage {
  const value = process.env.STAGE ?? 'dev'
  const stage = STAGES.find((candidate) => candidate === value)
  if (!stage) throw new Error(`STAGE must be one of ${STAGES.join(', ')}; got ${value}`)
  return stage
}

const app = new App()
const stage = readStage()

new LeadexStack(app, `Leadex-${stage}`, {
  stage,
  frontendUrl: requireEnv('FRONTEND_URL'),
  pipelineVersion: process.env.PIPELINE_VERSION ?? '1',
  llmModels: { smart: requireEnv('LLM_MODEL_SMART'), fast: requireEnv('LLM_MODEL_FAST') },
  ...(process.env.SENTRY_DSN ? { sentryDsn: process.env.SENTRY_DSN } : {}),
  ingestEnabled: process.env.INGEST_ENABLED === 'true',
  ...(process.env.CC_DOMAIN_RANKS_URL ? { ccDomainRanksUrl: process.env.CC_DOMAIN_RANKS_URL } : {}),
  ...(process.env.INGEST_CC_MAX_DOMAINS ? { ingestCcMaxDomains: Number(process.env.INGEST_CC_MAX_DOMAINS) } : {}),
  ...(process.env.INGEST_PROFILE_MAX_PER_RUN ? { profileMaxPerRun: Number(process.env.INGEST_PROFILE_MAX_PER_RUN) } : {}),
  ...(process.env.INGEST_PROFILE_CONCURRENCY ? { profileConcurrency: Number(process.env.INGEST_PROFILE_CONCURRENCY) } : {}),
  ...(process.env.LLM_FAST_INPUT_USD_PER_MTOK && process.env.LLM_FAST_OUTPUT_USD_PER_MTOK
    ? { llmFastPrices: { input: Number(process.env.LLM_FAST_INPUT_USD_PER_MTOK), output: Number(process.env.LLM_FAST_OUTPUT_USD_PER_MTOK) } }
    : {}),
  ...(process.env.INGEST_PEOPLE_MAX_PER_RUN ? { peopleMaxPerRun: Number(process.env.INGEST_PEOPLE_MAX_PER_RUN) } : {}),
  ...(process.env.INGEST_PEOPLE_CONCURRENCY ? { peopleConcurrency: Number(process.env.INGEST_PEOPLE_CONCURRENCY) } : {}),
  ...(process.env.INGEST_EMAIL_MAX_PER_RUN ? { emailMaxPerRun: Number(process.env.INGEST_EMAIL_MAX_PER_RUN) } : {}),
  ...(process.env.EMAIL_VERIFIER === 'bouncer' && process.env.BOUNCER_API_URL ? { emailVerifier: { name: 'bouncer' as const, apiUrl: process.env.BOUNCER_API_URL } } : {}),
  ...(process.env.GLEIF_API_URL && process.env.GLEIF_RECORD_URL_BASE
    ? { gleif: {
        apiUrl: process.env.GLEIF_API_URL, recordUrlBase: process.env.GLEIF_RECORD_URL_BASE,
        ...(process.env.INGEST_GLEIF_MATCH_PER_RUN ? { matchPerRun: Number(process.env.INGEST_GLEIF_MATCH_PER_RUN) } : {}),
      } }
    : {}),
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: requireEnv('AWS_REGION') },
})
