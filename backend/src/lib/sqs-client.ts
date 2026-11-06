import { SQSClient } from '@aws-sdk/client-sqs'

// endpoint: a local SQS-compatible queue (ElasticMQ in docker-compose.yml); unset in AWS.
export function createSqsClient(region: string, endpoint?: string): SQSClient {
  return new SQSClient({ region, ...(endpoint ? { endpoint } : {}) })
}
