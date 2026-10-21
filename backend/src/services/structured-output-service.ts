import type { z } from 'zod'
import { PipelineError } from '../lib/errors.js'
import { logInfo } from '../lib/logger.js'
import type { LlmEffort, LlmJsonResponse, LlmRepository, LlmTurn, StepId } from '../types/index.js'

export interface StructuredRequest<T> {
  step: StepId
  model: string
  effort: LlmEffort
  maxTokens: number
  system: string
  prompt: string
  schema: z.ZodType<T>
  // PipelineError code used when the output is still invalid after the repair attempt.
  failureCode: string
}

function logUsage(step: StepId, attempt: number, response: LlmJsonResponse): void {
  const { usage } = response
  logInfo('llm call', { step, attempt, model: usage.model, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, cacheReadTokens: usage.cacheReadTokens, ok: response.ok })
}

function describeIssues(error: z.ZodError): string {
  return error.issues.map((issue) => `- ${issue.path.join('.') || '(root)'}: ${issue.message}`).join('\n')
}

type Attempt<T> = { ok: true; value: T } | { ok: false; problem: string; rawText: string }

async function attempt<T>(llm: LlmRepository, request: StructuredRequest<T>, turns: LlmTurn[], index: number): Promise<Attempt<T>> {
  const response = await llm.generateJson({ model: request.model, effort: request.effort, maxTokens: request.maxTokens, system: request.system, schema: request.schema, turns })
  logUsage(request.step, index, response)
  if (!response.ok && response.reason === 'refusal') {
    throw new PipelineError('llm_refused', 'The model declined to analyze this site')
  }
  if (!response.ok) return { ok: false, problem: `The answer was ${response.reason === 'truncated' ? 'cut off' : 'not valid JSON'}.`, rawText: response.rawText }
  const parsed = request.schema.safeParse(response.value)
  if (parsed.success) return { ok: true, value: parsed.data }
  return { ok: false, problem: `The answer did not pass validation:\n${describeIssues(parsed.error)}`, rawText: response.rawText }
}

// One request, then at most one repair request that shows the model its own output and what was wrong with it.
export async function generateStructured<T>(llm: LlmRepository, request: StructuredRequest<T>): Promise<T> {
  const firstTurns: LlmTurn[] = [{ role: 'user', text: request.prompt }]
  const first = await attempt(llm, request, firstTurns, 1)
  if (first.ok) return first.value
  const repairTurns: LlmTurn[] = [
    ...firstTurns,
    { role: 'assistant', text: first.rawText || '{}' },
    { role: 'user', text: `${first.problem}\nReturn the complete corrected JSON object.` },
  ]
  const second = await attempt(llm, request, repairTurns, 2)
  if (second.ok) return second.value
  throw new PipelineError(request.failureCode, 'The analysis produced an invalid result. Please try again.')
}
