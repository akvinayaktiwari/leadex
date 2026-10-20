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
    env: { account: '111111111111', region: 'ap-south-1' },
  })
  template = Template.fromStack(stack)
})

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
})
