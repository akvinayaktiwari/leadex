import { randomUUID } from 'node:crypto'

export function newRunId(): string {
  return `run_${randomUUID()}`
}
