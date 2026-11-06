// Credit balances on leadex_users and the append-only leadex_credit_ledger (spec "Credits"). Every change is one
// transaction: the balance update (a debit only while the balance covers it), a ledger entry, and a once-only key.
import { TransactionCanceledException } from '@aws-sdk/client-dynamodb'
import { GetCommand, PutCommand, TransactWriteCommand, type DynamoDBDocumentClient, type TransactWriteCommandInput } from '@aws-sdk/lib-dynamodb'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { CreditAccount, CreditChange, CreditChangeResult, CreditsRepository } from '../types/index.js'

const accountSchema = z.object({ userId: z.string(), email: z.string(), creditBalance: z.number(), createdAt: z.string() }) satisfies z.ZodType<CreditAccount>

const BALANCE = 0
const IDEMPOTENCY = 2

function cancelledAt(error: unknown, index: number): boolean {
  return error instanceof TransactionCanceledException && error.CancellationReasons?.[index]?.Code === 'ConditionalCheckFailed'
}

function applyItems(tables: { users: string; ledger: string }, change: CreditChange): NonNullable<TransactWriteCommandInput['TransactItems']> {
  const required = Math.max(0, -change.credits)
  return [
    { Update: {
      TableName: tables.users, Key: { userId: change.userId },
      UpdateExpression: 'SET creditBalance = creditBalance + :delta',
      ConditionExpression: 'attribute_exists(userId) AND creditBalance >= :required',
      ExpressionAttributeValues: { ':delta': change.credits, ':required': required },
    } },
    { Put: {
      TableName: tables.ledger, ConditionExpression: 'attribute_not_exists(entryKey)',
      Item: { userId: change.userId, entryKey: `${change.at}#${randomUUID()}`, kind: change.kind, credits: change.credits, reference: change.reference, createdAt: change.at },
    } },
    { Put: {
      TableName: tables.ledger, ConditionExpression: 'attribute_not_exists(entryKey)',
      Item: { userId: change.userId, entryKey: `once#${change.idempotencyKey}`, createdAt: change.at },
    } },
  ]
}

const MARKER = 3

// The account, and with a free grant its ledger entry, its once-only key and the email-domain marker, as one transaction.
function accountItems(tables: { users: string; ledger: string }, account: CreditAccount, freeGrant?: { credits: number; markerId?: string | undefined }): NonNullable<TransactWriteCommandInput['TransactItems']> {
  const credits = freeGrant?.credits ?? 0
  const items: NonNullable<TransactWriteCommandInput['TransactItems']> = [
    { Put: { TableName: tables.users, Item: { ...account, creditBalance: credits }, ConditionExpression: 'attribute_not_exists(userId)' } },
  ]
  if (!freeGrant) return items
  const { userId, createdAt } = account
  items.push(
    { Put: { TableName: tables.ledger, Item: { userId, entryKey: `${createdAt}#${randomUUID()}`, kind: 'free_grant', credits, reference: 'signup', createdAt } } },
    { Put: { TableName: tables.ledger, Item: { userId, entryKey: `once#free-grant#${userId}`, createdAt } } },
  )
  if (freeGrant.markerId) {
    items.push({ Put: { TableName: tables.users, Item: { userId: `marker#${freeGrant.markerId}`, claimedBy: userId, createdAt }, ConditionExpression: 'attribute_not_exists(userId)' } })
  }
  return items
}

export function createCreditsTableRepository(client: DynamoDBDocumentClient, tables: { users: string; ledger: string }): CreditsRepository {
  return {
    async getAccount(userId: string): Promise<CreditAccount | undefined> {
      const result = await client.send(new GetCommand({ TableName: tables.users, Key: { userId }, ConsistentRead: true }))
      return result.Item ? accountSchema.parse(result.Item) : undefined
    },
    async createAccount(account: CreditAccount, freeGrant?: { credits: number; markerId?: string | undefined }): Promise<'created' | 'exists' | 'marker_taken'> {
      try {
        await client.send(new TransactWriteCommand({ TransactItems: accountItems(tables, account, freeGrant) }))
        return 'created'
      } catch (error) {
        if (cancelledAt(error, 0)) return 'exists'
        if (freeGrant?.markerId && cancelledAt(error, MARKER)) return 'marker_taken'
        throw error
      }
    },
    async apply(change: CreditChange): Promise<CreditChangeResult> {
      try {
        await client.send(new TransactWriteCommand({ TransactItems: applyItems(tables, change) }))
        return 'applied'
      } catch (error) {
        if (cancelledAt(error, IDEMPOTENCY)) return 'duplicate'
        if (cancelledAt(error, BALANCE)) return 'insufficient'
        throw error
      }
    },
  }
}
