import Anthropic from '@anthropic-ai/sdk'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createAnthropicLlmRepository } from '../src/repositories/llm-repository.js'

interface CapturedRequest {
  url: string
  headers: Headers
  body: Record<string, unknown>
}

// Response shape follows the Messages API reference; it is hand-written, not recorded from a live call.
function messageResponse(text: string, stopReason: string): Record<string, unknown> {
  return {
    id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-opus-5-5',
    content: [{ type: 'text', text }], stop_reason: stopReason, stop_sequence: null,
    usage: { input_tokens: 1200, output_tokens: 300, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  }
}

function clientReturning(response: Record<string, unknown>, captured: CapturedRequest[]): Anthropic {
  const fakeFetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    captured.push({ url: String(input), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) as Record<string, unknown> })
    return new Response(JSON.stringify(response), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  return new Anthropic({ apiKey: 'test-key', fetch: fakeFetch, maxRetries: 0 })
}

const schema = z.object({ name: z.string(), tags: z.array(z.string()) })
const request = (model: string) => ({ model, system: 'sys', turns: [{ role: 'user' as const, text: 'hi' }], schema, maxTokens: 500, effort: 'low' as const })

describe('Anthropic LLM repository (contract)', () => {
  // protects=the request uses the Messages API with structured output, effort, and the server-side refusal fallback;
  // fails_when=the JSON schema, effort or fallbacks/beta header is missing, or turns are mapped to the wrong roles;
  // no_claim=does not call the live API; the API accepting this exact body is verified only by a live run.
  it('sends a structured-output request with refusal fallback', async () => {
    const captured: CapturedRequest[] = []
    const llm = createAnthropicLlmRepository(clientReturning(messageResponse('{"name":"Acme","tags":[]}', 'end_turn'), captured))
    const result = await llm.generateJson(request('claude-opus-5-5'))
    expect(result).toMatchObject({ ok: true, value: { name: 'Acme', tags: [] }, usage: { inputTokens: 1200, outputTokens: 300 } })
    const sent = captured[0]
    expect(sent?.url).toContain('/v1/messages')
    expect(sent?.headers.get('anthropic-beta')).toContain('server-side-fallback-2026-07-01')
    expect(sent?.body).toMatchObject({ model: 'claude-opus-5-5', max_tokens: 500, system: 'sys', fallbacks: 'default', messages: [{ role: 'user', content: 'hi' }] })
    const outputConfig = sent?.body.output_config as { effort: string; format: { type: string; schema: { properties: Record<string, unknown> } } }
    expect(outputConfig.effort).toBe('low')
    expect(outputConfig.format.type).toBe('json_schema')
    expect(Object.keys(outputConfig.format.schema.properties)).toEqual(['name', 'tags'])
  })

  // protects=models without server-side fallback don't get the fallbacks parameter (it would 400);
  // fails_when=a Haiku request carries fallbacks or the beta header;
  // no_claim=the supported-model list is from the API docs as of 2026-10 and may grow.
  it('omits fallbacks for models that do not support them', async () => {
    const captured: CapturedRequest[] = []
    const llm = createAnthropicLlmRepository(clientReturning(messageResponse('{"name":"Acme","tags":[]}', 'end_turn'), captured))
    await llm.generateJson(request('claude-haiku-5-5'))
    expect(captured[0]?.body.fallbacks).toBeUndefined()
    expect(captured[0]?.headers.get('anthropic-beta') ?? '').not.toContain('server-side-fallback')
  })

  // protects=refusals, truncation and non-JSON text come back as typed failures, not exceptions or bad data;
  // fails_when=a refusal or cut-off answer is parsed as valid output;
  // no_claim=does not cover HTTP errors (the SDK retries and throws typed errors for those).
  it('maps refusal, truncation and invalid JSON to failures', async () => {
    const cases: [string, string, string][] = [['', 'refusal', 'refusal'], ['{"name":"Ac', 'max_tokens', 'truncated'], ['Sure! Here it is', 'end_turn', 'not_json']]
    for (const [text, stopReason, reason] of cases) {
      const llm = createAnthropicLlmRepository(clientReturning(messageResponse(text, stopReason), []))
      expect(await llm.generateJson(request('claude-opus-5-5'))).toMatchObject({ ok: false, reason })
    }
  })
})
