import type Anthropic from '@anthropic-ai/sdk'
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod'
import type { LlmJsonRequest, LlmJsonResponse, LlmRepository, LlmUsage } from '../types/index.js'

const FALLBACK_BETA = 'server-side-fallback-2026-07-01'

// Models that accept `fallbacks: "default"` (on a policy decline the API re-runs the request on a fallback model).
const FALLBACK_MODELS = new Set(['claude-fable-5-1', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5'])

type BetaMessage = Anthropic.Beta.Messages.BetaMessage

function toUsage(message: BetaMessage): LlmUsage {
  return {
    model: message.model,
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
    cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
  }
}

function parseJson(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch (error) {
    // Reported to the caller as `not_json`, which triggers its repair retry.
    if (error instanceof SyntaxError) return { ok: false }
    throw error
  }
}

function fallbackParams(model: string): { betas?: string[]; fallbacks?: 'default' } {
  return FALLBACK_MODELS.has(model) ? { betas: [FALLBACK_BETA], fallbacks: 'default' } : {}
}

export function createAnthropicLlmRepository(client: Anthropic): LlmRepository {
  return {
    async generateJson(request: LlmJsonRequest): Promise<LlmJsonResponse> {
      const message = await client.beta.messages.create({
        model: request.model,
        max_tokens: request.maxTokens,
        system: request.system,
        messages: request.turns.map((turn) => ({ role: turn.role, content: turn.text })),
        output_config: { effort: request.effort, format: betaZodOutputFormat(request.schema) },
        ...fallbackParams(request.model),
      })
      const usage = toUsage(message)
      const rawText = message.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('')
      if (message.stop_reason === 'refusal') return { ok: false, reason: 'refusal', rawText, usage }
      if (message.stop_reason === 'max_tokens') return { ok: false, reason: 'truncated', rawText, usage }
      const parsed = parseJson(rawText)
      return parsed.ok ? { ok: true, value: parsed.value, rawText, usage } : { ok: false, reason: 'not_json', rawText, usage }
    },
  }
}
