import { afterEach, describe, expect, it, vi } from 'vitest'
import { getDeviceId } from './device-id'

afterEach(() => {
  vi.restoreAllMocks()
  window.localStorage.clear()
})

describe('device id', () => {
  // protects=the browser keeps one random device id across page loads, and blocked storage still yields a stable id for the page
  // instead of throwing into the form;
  // fails_when=each submit sends a new id (the device limit never applies) or private mode breaks the form;
  // no_claim=the server-side limit is tested in the backend.
  it('keeps one id, even without storage', () => {
    const first = getDeviceId()
    expect(first).toMatch(/^[0-9a-f-]{36}$/)
    expect(getDeviceId()).toBe(first)
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    const fallback = getDeviceId()
    expect(getDeviceId()).toBe(fallback)
  })
})
