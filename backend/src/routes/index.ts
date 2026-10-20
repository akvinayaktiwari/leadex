import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { getApiEnv } from '../lib/env.js'
import { logError } from '../lib/logger.js'
import { captureError } from '../lib/sentry.js'
import type { ApiErrorBody } from '../types/index.js'
import { healthRoutes } from './health-routes.js'

function errorBody(code: string, message: string): ApiErrorBody {
  return { error: { code, message } }
}

export function createApp(): Hono {
  const env = getApiEnv()
  const app = new Hono()

  app.use('/api/*', cors({ origin: env.FRONTEND_URL, credentials: true }))
  app.route('/api/health', healthRoutes)

  app.notFound((c) => c.json(errorBody('not_found', 'Route not found'), 404))
  app.onError((error, c) => {
    logError('unhandled request error', error, { path: c.req.path })
    captureError(error, { path: c.req.path })
    return c.json(errorBody('internal_error', 'Something went wrong'), 500)
  })

  return app
}
