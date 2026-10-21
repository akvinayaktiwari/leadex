import Anthropic from '@anthropic-ai/sdk'

const REQUEST_TIMEOUT_MS = 90_000
// The SDK retries 408/409/429/5xx and connection errors with backoff.
const MAX_RETRIES = 3

export function createAnthropicClient(apiKey: string): Anthropic {
  return new Anthropic({ apiKey, timeout: REQUEST_TIMEOUT_MS, maxRetries: MAX_RETRIES })
}
