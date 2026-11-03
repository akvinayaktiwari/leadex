import { Hono } from 'hono'
import { z } from 'zod'
import { errorBody } from '../lib/http-errors.js'
import type { ApiServices } from '../types/index.js'

const startBody = z.object({ url: z.string().min(1).max(2_000) })

const MESSAGES = {
  invalid_url: 'Enter a website like yourcompany.com',
  unsupported_host: 'That address is not a public company website',
  analyses_disabled: 'Analyses are not open yet',
} as const

export function createAnalysesRoutes(services: ApiServices): Hono {
  return new Hono().post('/', async (c) => {
    const parsed = startBody.safeParse(await c.req.json().catch(() => undefined))
    if (!parsed.success) return c.json(errorBody('invalid_url', MESSAGES.invalid_url), 400)
    const result = await services.analyses.start(parsed.data.url)
    if (result.ok) return c.json({ runId: result.runId, domain: result.domain }, 202)
    return c.json(errorBody(result.code, MESSAGES[result.code]), result.code === 'analyses_disabled' ? 503 : 400)
  })
}
