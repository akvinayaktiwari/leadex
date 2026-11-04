import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager'
import { z } from 'zod'
import type { SecretsRepository } from '../types/index.js'

const jsonSecretSchema = z.record(z.string(), z.string())

export function createSecretsRepository(region: string): SecretsRepository {
  const client = new SecretsManagerClient({ region })
  return {
    async readField(secretId: string, field: string): Promise<string> {
      const result = await client.send(new GetSecretValueCommand({ SecretId: secretId }))
      const value = jsonSecretSchema.parse(JSON.parse(result.SecretString ?? '{}'))[field]
      if (!value) throw new Error(`Secret ${secretId} has no ${field}`)
      return value
    },
  }
}
