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
  ...(process.env.SENTRY_DSN ? { sentryDsn: process.env.SENTRY_DSN } : {}),
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: requireEnv('AWS_REGION') },
})
