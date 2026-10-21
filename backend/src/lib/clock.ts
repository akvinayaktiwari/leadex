import type { Clock } from '../types/index.js'

export const systemClock: Clock = { now: () => new Date() }

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
