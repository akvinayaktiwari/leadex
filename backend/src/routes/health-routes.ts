import { Hono } from 'hono'
import { getHealth } from '../services/health-service.js'

export const healthRoutes = new Hono().get('/', (c) => c.json(getHealth()))
