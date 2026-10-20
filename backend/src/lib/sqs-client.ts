import { SQSClient } from '@aws-sdk/client-sqs'

export function createSqsClient(region: string): SQSClient {
  return new SQSClient({ region })
}
