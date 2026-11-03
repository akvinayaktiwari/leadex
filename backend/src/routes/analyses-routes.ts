import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { errorBody } from '../lib/http-errors.js'
import type { ApiServices, ClientIpReader } from '../types/index.js'

const startBody = z.object({
  url: z.string().min(1).max(2_000),
  deviceId: z.string().min(8).max(100).optional(),
  turnstileToken: z.string().max(4_096).optional(),
})

const MESSAGES = {
  invalid_url: 'Enter a website like yourcompany.com',
  unsupported_host: 'That address is not a public company website',
  analyses_disabled: 'Analyses are not open yet',
  turnstile_failed: 'Please confirm you are human and try again',
  rate_limited: 'You have used today\'s free analyses. Try again tomorrow.',
} as const

const STATUS = { invalid_url: 400, unsupported_host: 400, analyses_disabled: 503, turnstile_failed: 400, rate_limited: 429 } as const

const clientIp = (c: Context, readClientIp: ClientIpReader): string => readClientIp(c) ?? 'unknown'

export function createAnalysesRoutes(services: ApiServices, readClientIp: ClientIpReader): Hono {
  return new Hono().post('/', async (c) => {
    const parsed = startBody.safeParse(await c.req.json().catch(() => undefined))
    if (!parsed.success) return c.json(errorBody('invalid_url', MESSAGES.invalid_url), 400)
    const result = await services.analyses.start({ ...parsed.data, ip: clientIp(c, readClientIp) })
    if (result.ok) return c.json({ runId: result.runId, domain: result.domain, cached: result.cached }, 202)
    return c.json(errorBody(result.code, MESSAGES[result.code]), STATUS[result.code])
  })
}
