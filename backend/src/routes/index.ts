import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { getApiEnv } from '../lib/env.js'
import { errorBody } from '../lib/http-errors.js'
import { logError } from '../lib/logger.js'
import { captureError } from '../lib/sentry.js'
import type { ApiServices } from '../types/index.js'
import { healthRoutes } from './health-routes.js'
import { createRunsRoutes } from './runs-routes.js'

export function createApp(services: ApiServices): Hono {
  const env = getApiEnv()
  const app = new Hono()

  app.use('/api/*', cors({ origin: env.FRONTEND_URL, credentials: true }))
  app.route('/api/health', healthRoutes)
  app.route('/api/runs', createRunsRoutes(services))

  app.notFound((c) => c.json(errorBody('not_found', 'Route not found'), 404))
  app.onError((error, c) => {
    logError('unhandled request error', error, { path: c.req.path })
    captureError(error, { path: c.req.path })
    return c.json(errorBody('internal_error', 'Something went wrong'), 500)
  })

  return app
}
