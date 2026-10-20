import type { LogFields } from '../types/index.js'

function write(level: 'info' | 'error', message: string, fields: LogFields): void {
  const line = JSON.stringify({ level, message, time: new Date().toISOString(), ...fields })
  if (level === 'error') {
    console.error(line)
    return
  }
  console.log(line)
}

export function logInfo(message: string, fields: LogFields = {}): void {
  write('info', message, fields)
}

export function logError(message: string, error: unknown, fields: LogFields = {}): void {
  const detail = error instanceof Error ? error.message : String(error)
  write('error', message, { ...fields, error: detail })
}
