import { DeleteMessageCommand, ReceiveMessageCommand, SendMessageCommand, type SQSClient } from '@aws-sdk/client-sqs'
import type { QueueMessage, RunJobMessage, RunQueueRepository } from '../types/index.js'

export function createRunQueueRepository(client: SQSClient, queueUrl: string): RunQueueRepository {
  return {
    async receive(maxMessages: number, waitSeconds: number): Promise<QueueMessage[]> {
      const result = await client.send(
        new ReceiveMessageCommand({
          QueueUrl: queueUrl,
          MaxNumberOfMessages: maxMessages,
          WaitTimeSeconds: waitSeconds,
        }),
      )
      return (result.Messages ?? []).flatMap((message) =>
        message.ReceiptHandle && message.Body !== undefined
          ? [{ receiptHandle: message.ReceiptHandle, body: message.Body }]
          : [],
      )
    },
    async remove(receiptHandle: string): Promise<void> {
      await client.send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: receiptHandle }))
    },
    async send(job: RunJobMessage): Promise<void> {
      await client.send(new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: JSON.stringify(job) }))
    },
  }
}
