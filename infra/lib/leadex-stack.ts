import * as path from 'node:path'
import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib'
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb'
import * as ec2 from 'aws-cdk-lib/aws-ec2'
import * as ecs from 'aws-cdk-lib/aws-ecs'
import * as ecsPatterns from 'aws-cdk-lib/aws-ecs-patterns'
import type * as iam from 'aws-cdk-lib/aws-iam'
import * as kms from 'aws-cdk-lib/aws-kms'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs'
import * as sqs from 'aws-cdk-lib/aws-sqs'
import type { Construct } from 'constructs'

export type Stage = 'dev' | 'staging' | 'prod'

export interface LeadexStackProps extends StackProps {
  stage: Stage
  frontendUrl: string
  pipelineVersion: string
  sentryDsn?: string
}

interface TableSpec {
  envName: string
  id: string
  partitionKey: string
  sortKey?: { name: string; type: dynamodb.AttributeType }
  ttlAttribute?: string
}

const S = dynamodb.AttributeType.STRING
const N = dynamodb.AttributeType.NUMBER

export const TABLE_SPECS: TableSpec[] = [
  { envName: 'TABLE_USERS', id: 'users', partitionKey: 'userId' },
  { envName: 'TABLE_ANALYSES', id: 'analyses', partitionKey: 'domain', sortKey: { name: 'pipelineVersion', type: S }, ttlAttribute: 'expiresAt' },
  { envName: 'TABLE_RUNS', id: 'runs', partitionKey: 'runId' },
  { envName: 'TABLE_RUN_EVENTS', id: 'run_events', partitionKey: 'runId', sortKey: { name: 'seq', type: N }, ttlAttribute: 'expiresAt' },
  { envName: 'TABLE_LEADS', id: 'leads', partitionKey: 'userId', sortKey: { name: 'leadId', type: S } },
  { envName: 'TABLE_CREDIT_LEDGER', id: 'credit_ledger', partitionKey: 'userId', sortKey: { name: 'entryKey', type: S } },
  { envName: 'TABLE_INTEGRATIONS', id: 'integrations', partitionKey: 'userId', sortKey: { name: 'provider', type: S } },
  { envName: 'TABLE_RATE_LIMITS', id: 'rate_limits', partitionKey: 'key', ttlAttribute: 'expiresAt' },
]

const REPO_ROOT = path.join(__dirname, '..', '..')
const BACKEND_DIR = path.join(REPO_ROOT, 'backend')

export class LeadexStack extends Stack {
  constructor(scope: Construct, id: string, props: LeadexStackProps) {
    super(scope, id, props)
    const removalPolicy = props.stage === 'prod' ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY
    const key = new kms.Key(this, 'DataKey', { enableKeyRotation: true, removalPolicy })
    const tables = this.createTables(props.stage, removalPolicy)
    const queue = this.createQueues(key)
    const environment = this.sharedEnvironment(props, tables, queue, key)
    const { api, stream } = this.createFunctions(environment, tables, queue, key)
    this.createWorker(environment, tables, queue, key)
    new CfnOutput(this, 'ApiUrl', { value: api.url })
    new CfnOutput(this, 'StreamUrl', { value: stream.url })
    new CfnOutput(this, 'RunsQueueUrl', { value: queue.queueUrl })
  }

  private createTables(stage: Stage, removalPolicy: RemovalPolicy): Map<string, dynamodb.Table> {
    const tables = new Map<string, dynamodb.Table>()
    for (const spec of TABLE_SPECS) {
      const table = new dynamodb.Table(this, `Table-${spec.id}`, {
        tableName: `leadex-${stage}-${spec.id}`,
        partitionKey: { name: spec.partitionKey, type: S },
        ...(spec.sortKey ? { sortKey: spec.sortKey } : {}),
        ...(spec.ttlAttribute ? { timeToLiveAttribute: spec.ttlAttribute } : {}),
        billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
        pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: stage === 'prod' },
        removalPolicy,
      })
      tables.set(spec.envName, table)
    }
    return tables
  }

  private createQueues(key: kms.Key): sqs.Queue {
    const deadLetterQueue = new sqs.Queue(this, 'RunsDlq', {
      encryption: sqs.QueueEncryption.KMS,
      encryptionMasterKey: key,
      retentionPeriod: Duration.days(14),
    })
    return new sqs.Queue(this, 'RunsQueue', {
      encryption: sqs.QueueEncryption.KMS,
      encryptionMasterKey: key,
      visibilityTimeout: Duration.minutes(16),
      deadLetterQueue: { queue: deadLetterQueue, maxReceiveCount: 2 },
    })
  }

  private sharedEnvironment(
    props: LeadexStackProps,
    tables: Map<string, dynamodb.Table>,
    queue: sqs.Queue,
    key: kms.Key,
  ): Record<string, string> {
    const environment: Record<string, string> = {
      STAGE: props.stage,
      FRONTEND_URL: props.frontendUrl,
      PIPELINE_VERSION: props.pipelineVersion,
      SQS_RUNS_QUEUE_URL: queue.queueUrl,
      KMS_KEY_ID: key.keyId,
      LEAD_BUILDS_ENABLED: 'false',
      ...(props.sentryDsn ? { SENTRY_DSN: props.sentryDsn } : {}),
    }
    for (const [envName, table] of tables) environment[envName] = table.tableName
    return environment
  }

  private grantData(
    grantee: iam.IGrantable,
    tables: Map<string, dynamodb.Table>,
    key: kms.Key,
  ): void {
    for (const table of tables.values()) table.grantReadWriteData(grantee)
    key.grantEncryptDecrypt(grantee)
  }

  private nodeFunction(id: string, entry: string, handler: string, timeout: Duration, environment: Record<string, string>): lambdaNode.NodejsFunction {
    return new lambdaNode.NodejsFunction(this, id, {
      entry: path.join(BACKEND_DIR, entry),
      handler,
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 512,
      timeout,
      environment,
      projectRoot: REPO_ROOT,
      depsLockFilePath: path.join(REPO_ROOT, 'package-lock.json'),
      bundling: { format: lambdaNode.OutputFormat.ESM, target: 'node22', externalModules: ['@aws-sdk/*'] },
    })
  }

  private createFunctions(
    environment: Record<string, string>,
    tables: Map<string, dynamodb.Table>,
    queue: sqs.Queue,
    key: kms.Key,
  ): { api: lambda.FunctionUrl; stream: lambda.FunctionUrl } {
    const apiFn = this.nodeFunction('ApiFunction', 'index.ts', 'handler', Duration.seconds(30), environment)
    const streamFn = this.nodeFunction('StreamFunction', 'stream.ts', 'streamingHandler', Duration.minutes(15), environment)
    for (const fn of [apiFn, streamFn]) this.grantData(fn, tables, key)
    queue.grantSendMessages(apiFn)
    const api = apiFn.addFunctionUrl({ authType: lambda.FunctionUrlAuthType.NONE, invokeMode: lambda.InvokeMode.BUFFERED })
    const stream = streamFn.addFunctionUrl({ authType: lambda.FunctionUrlAuthType.NONE, invokeMode: lambda.InvokeMode.RESPONSE_STREAM })
    return { api, stream }
  }

  private createWorker(
    environment: Record<string, string>,
    tables: Map<string, dynamodb.Table>,
    queue: sqs.Queue,
    key: kms.Key,
  ): void {
    // Public subnets with no NAT gateway keep idle cost near zero; tasks get public IPs for egress.
    const vpc = new ec2.Vpc(this, 'WorkerVpc', {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [{ name: 'public', subnetType: ec2.SubnetType.PUBLIC }],
    })
    const service = new ecsPatterns.QueueProcessingFargateService(this, 'Worker', {
      vpc,
      queue,
      image: ecs.ContainerImage.fromAsset(REPO_ROOT, { file: 'backend/Dockerfile.worker' }),
      cpu: 512,
      memoryLimitMiB: 1024,
      minScalingCapacity: 0,
      maxScalingCapacity: 4,
      assignPublicIp: true,
      taskSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      runtimePlatform: { cpuArchitecture: ecs.CpuArchitecture.ARM64, operatingSystemFamily: ecs.OperatingSystemFamily.LINUX },
      // Lambda sets (and reserves) AWS_REGION itself; the Fargate container needs it passed in.
      environment: { ...environment, AWS_REGION: this.region },
      circuitBreaker: { rollback: true },
      minHealthyPercent: 100,
    })
    this.grantData(service.taskDefinition.taskRole, tables, key)
  }
}
