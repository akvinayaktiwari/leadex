// Keys for the anonymous daily limits. Addresses and device ids are stored only as hashes.
import { createHash } from 'node:crypto'

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex')

// One key per IP and per device id for the current UTC day.
export function anonymousLimitKeys(ip: string, deviceId: string | undefined, now: Date): string[] {
  const day = now.toISOString().slice(0, 10)
  const keys = [`ip#${sha256(ip)}#${day}`]
  if (deviceId) keys.push(`device#${sha256(deviceId)}#${day}`)
  return keys
}
