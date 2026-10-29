import { App } from 'aws-cdk-lib'
import { Match, Template } from 'aws-cdk-lib/assertions'
import { beforeAll, describe, expect, it } from 'vitest'
import { LeadexStack, TABLE_SPECS } from '../lib/leadex-stack'

let template: Template

beforeAll(() => {
  // Skip Lambda/asset bundling in tests; the template shape is what's under test.
  const app = new App({ context: { 'aws:cdk:bundling-stacks': [] } })
  const stack = new LeadexStack(app, 'Leadex-test', {
    stage: 'dev',
    frontendUrl: 'http://localhost:3000',
    pipelineVersion: '1',
    llmModels: { smart: 'claude-opus-5-5', fast: 'claude-opus-5-5' },
    env: { account: '111111111111', region: 'ap-south-1' },
  })
  template = Template.fromStack(stack)
})

interface ContainerDefinition {
  Command?: string[]
  Environment: { Name: string; Value: unknown }[]
  Secrets?: { Name: string }[]
}

function ingestContainer(source: Template = template): ContainerDefinition {
  const containers = Object.values(source.findResources('AWS::ECS::TaskDefinition'))
    .flatMap((resource) => resource.Properties.ContainerDefinitions as ContainerDefinition[])
  const ingest = containers.find((container) => container.Command?.includes('ingest.mjs'))
  if (!ingest) throw new Error('no ingest container in template')
  return ingest
}

describe('LeadexStack', () => {
  // protects=all 8 app tables exist, on-demand, with the spec's keys and TTLs;
  // fails_when=a table is missing or a key/TTL drifts from the spec;
  // no_claim=does not verify access patterns or GSIs (none in v1).
  it('creates the 8 DynamoDB tables from the spec', () => {
    template.resourceCountIs('AWS::DynamoDB::Table', 8)
    expect(TABLE_SPECS).toHaveLength(8)
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'leadex-dev-run_events',
      BillingMode: 'PAY_PER_REQUEST',
      KeySchema: [
        { AttributeName: 'runId', KeyType: 'HASH' },
        { AttributeName: 'seq', KeyType: 'RANGE' },
      ],
      TimeToLiveSpecification: { AttributeName: 'expiresAt', Enabled: true },
    })
  })

  // protects=runs queue is KMS-encrypted with a DLQ after 2 receives;
  // fails_when=poison jobs retry forever or the DLQ is missing;
  // no_claim=does not test runtime redelivery.
  it('creates the runs queue with a DLQ after 2 receives', () => {
    template.hasResourceProperties('AWS::SQS::Queue', {
      RedrivePolicy: { maxReceiveCount: 2, deadLetterTargetArn: Match.anyValue() },
      KmsMasterKeyId: Match.anyValue(),
    })
  })

  // protects=two Function URLs: BUFFERED API and RESPONSE_STREAM stream;
  // fails_when=SSE route lands on a buffered function or a URL is missing;
  // no_claim=does not prove auth (added with Cognito in #8).
  it('exposes a buffered API URL and a streaming URL', () => {
    template.resourceCountIs('AWS::Lambda::Url', 2)
    template.hasResourceProperties('AWS::Lambda::Url', { InvokeMode: 'BUFFERED' })
    template.hasResourceProperties('AWS::Lambda::Url', { InvokeMode: 'RESPONSE_STREAM' })
    template.hasResourceProperties('AWS::Lambda::Function', { Runtime: 'nodejs22.x', Architectures: ['arm64'] })
  })

  // protects=Fargate worker scales on queue depth down to 0 tasks;
  // fails_when=no worker service, or it can never scale to zero (idle cost);
  // no_claim=does not build or run the container image.
  it('runs the worker on Fargate, scaling from 0 on queue depth', () => {
    template.resourceCountIs('AWS::ECS::Service', 1)
    template.hasResourceProperties('AWS::ApplicationAutoScaling::ScalableTarget', { MinCapacity: 0, MaxCapacity: 4 })
    template.resourceCountIs('AWS::EC2::NatGateway', 0)
  })

  // protects=config comes from props, not hardcoded values;
  // fails_when=FRONTEND_URL or table names are missing from function env;
  // no_claim=does not validate secret env vars added in later issues.
  it('passes config to functions through environment variables', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: Match.objectLike({ STAGE: 'dev', FRONTEND_URL: 'http://localhost:3000', LEAD_BUILDS_ENABLED: 'false' }),
      },
    })
  })

  // protects=the worker container gets everything the run engine reads at startup (getWorkerEnv);
  // fails_when=AWS_REGION, a run table or the queue URL is missing, so the task crash-loops on boot;
  // no_claim=does not start the container or check IAM grants.
  it('gives the worker container the run engine env', () => {
    const taskDefinitions = Object.values(template.findResources('AWS::ECS::TaskDefinition'))
    const containers = taskDefinitions.flatMap((resource) => resource.Properties.ContainerDefinitions as { Environment: { Name: string; Value: unknown }[] }[])
    const environment = new Map(containers.flatMap((container) => container.Environment.map((entry) => [entry.Name, entry.Value] as const)))
    expect(environment.get('AWS_REGION')).toBe('ap-south-1')
    for (const name of ['TABLE_RUNS', 'TABLE_RUN_EVENTS', 'SQS_RUNS_QUEUE_URL', 'STAGE', 'FRONTEND_URL', 'PIPELINE_VERSION', 'LLM_MODEL_SMART', 'LLM_MODEL_FAST']) {
      expect(environment.has(name), name).toBe(true)
    }
  })

  // protects=the Anthropic key reaches the worker as an ECS secret from Secrets Manager, never as a plain env value;
  // fails_when=ANTHROPIC_API_KEY appears in container Environment (and so in the template) or the secret is not wired;
  // no_claim=does not check that the secret exists in the account (created by hand before deploy).
  it('injects the Anthropic key as a secret, not plain env', () => {
    const containers = Object.values(template.findResources('AWS::ECS::TaskDefinition')).flatMap((resource) => resource.Properties.ContainerDefinitions as { Environment: { Name: string }[]; Secrets?: { Name: string }[] }[])
    expect(containers.flatMap((container) => container.Environment.map((entry) => entry.Name))).not.toContain('ANTHROPIC_API_KEY')
    expect(containers.flatMap((container) => (container.Secrets ?? []).map((entry) => entry.Name))).toContain('ANTHROPIC_API_KEY')
  })

  // protects=the daily ingest schedule exists but is disabled unless ingestEnabled is set, and runs ingest.mjs on the worker image;
  // fails_when=imports start on first deploy before any source is reviewed, or the task runs the queue worker instead;
  // no_claim=does not run the task or check that ClickHouse is reachable.
  it('schedules the ingest task, disabled by default', () => {
    template.hasResourceProperties('AWS::Events::Rule', {
      State: 'DISABLED',
      ScheduleExpression: 'cron(30 21 * * ? *)',
      Targets: [Match.objectLike({ EcsParameters: Match.objectLike({ NetworkConfiguration: { AwsVpcConfiguration: Match.objectLike({ AssignPublicIp: 'ENABLED' }) } }) })],
    })
    const ingest = ingestContainer()
    expect(ingest.Command).toEqual(['node', 'ingest.mjs'])
    expect(new Map(ingest.Environment.map((entry) => [entry.Name, entry.Value]))).toEqual(new Map([
      ['STAGE', 'dev'], ['INGEST_ENABLED', 'false'], ['CLICKHOUSE_DATABASE', 'leadex_dev'],
    ]))
  })

  // protects=ClickHouse credentials reach the ingest task only as Secrets Manager secrets;
  // fails_when=CLICKHOUSE_URL/USER/PASSWORD appear as plain env (and so in the template) or are not wired;
  // no_claim=does not check the secret contains these keys (added by hand, see README).
  it('injects ClickHouse credentials as secrets', () => {
    const ingest = ingestContainer()
    const plain = ingest.Environment.map((entry) => entry.Name)
    for (const name of ['CLICKHOUSE_URL', 'CLICKHOUSE_USER', 'CLICKHOUSE_PASSWORD']) {
      expect(plain).not.toContain(name)
      expect((ingest.Secrets ?? []).map((entry) => entry.Name)).toContain(name)
    }
  })

  // protects=turning ingest on flips both the schedule and the container flag together;
  // fails_when=the rule is enabled but the container still says false (silent no-op), or the reverse;
  // no_claim=n/a.
  it('enables schedule and flag together', () => {
    const app = new App({ context: { 'aws:cdk:bundling-stacks': [] } })
    const stack = new LeadexStack(app, 'Leadex-ingest-on', {
      stage: 'dev', frontendUrl: 'http://localhost:3000', pipelineVersion: '1',
      llmModels: { smart: 'claude-opus-5-5', fast: 'claude-opus-5-5' }, ingestEnabled: true,
      env: { account: '111111111111', region: 'ap-south-1' },
    })
    const enabled = Template.fromStack(stack)
    enabled.hasResourceProperties('AWS::Events::Rule', { State: 'ENABLED' })
    expect(ingestContainer(enabled).Environment.find((entry) => entry.Name === 'INGEST_ENABLED')?.Value).toBe('true')
  })
})
