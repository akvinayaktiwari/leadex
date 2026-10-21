import { z } from 'zod'
import type { RunJobMessage } from '../types/index.js'

export const runJobMessageSchema = z.object({
  runId: z.string().min(1),
  type: z.enum(['analysis', 'lead_build']),
}) satisfies z.ZodType<RunJobMessage>
