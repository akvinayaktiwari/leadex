// Credits (#8): 1 credit = 1 delivered lead. New accounts get 25 free credits once per user and once per company email
// domain; debits go through the repository's conditional write, so the balance never goes below zero.
import { createHash } from 'node:crypto'
import { WEBMAIL_DOMAINS } from '../config/webmail-domains.js'
import type { Clock, CreditAccount, CreditChangeResult, CreditsRepository, CreditsService } from '../types/index.js'

export const FREE_CREDITS = 25

export interface CreditsServiceDeps {
  repository: CreditsRepository
  clock: Clock
}

function emailDomain(email: string): string {
  return (email.toLowerCase().split('@')[1] ?? '').trim()
}

// A company domain gets the free credits once in total (a marker claimed in the same transaction); webmail once per account.
function freeGrantFor(email: string): { credits: number; markerId?: string } | undefined {
  const domain = emailDomain(email)
  if (!domain) return undefined
  if (WEBMAIL_DOMAINS.has(domain)) return { credits: FREE_CREDITS }
  return { credits: FREE_CREDITS, markerId: `free-grant-domain#${createHash('sha256').update(domain).digest('hex')}` }
}

async function createAccount(deps: CreditsServiceDeps, userId: string, email: string): Promise<void> {
  const account: CreditAccount = { userId, email, creditBalance: 0, createdAt: deps.clock.now().toISOString() }
  const result = await deps.repository.createAccount(account, freeGrantFor(email))
  // Someone at this company domain already had the free credits: open the account without them.
  if (result === 'marker_taken') await deps.repository.createAccount(account)
}

export function createCreditsService(deps: CreditsServiceDeps): CreditsService {
  return {
    async ensureAccount(userId: string, email: string): Promise<CreditAccount> {
      const existing = await deps.repository.getAccount(userId)
      if (existing) return existing
      await createAccount(deps, userId, email)
      const account = await deps.repository.getAccount(userId)
      if (!account) throw new Error(`Account ${userId} was not created`)
      return account
    },
    async balance(userId: string): Promise<number> {
      return (await deps.repository.getAccount(userId))?.creditBalance ?? 0
    },
    async charge(userId: string, credits: number, runId: string): Promise<CreditChangeResult> {
      if (!Number.isInteger(credits) || credits <= 0) throw new Error(`A charge must be a positive whole number of credits, got ${credits}`)
      return deps.repository.apply({ userId, credits: -credits, kind: 'debit', reference: runId, idempotencyKey: `debit#${runId}`, at: deps.clock.now().toISOString() })
    },
  }
}
