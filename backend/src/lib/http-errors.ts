import type { ApiErrorBody } from '../types/index.js'

export function errorBody(code: string, message: string): ApiErrorBody {
  return { error: { code, message } }
}
