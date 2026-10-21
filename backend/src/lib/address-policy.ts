import { BlockList, isIP } from 'node:net'

// Blocks the crawler from reaching private, loopback, link-local (cloud metadata), CGNAT,
// documentation and multicast ranges. User-supplied URLs must never reach internal services.
const blocked = new BlockList()
const V4_RANGES: [string, number][] = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
]
const V6_RANGES: [string, number][] = [
  ['::', 128], ['::1', 128], ['64:ff9b::', 96], ['100::', 64], ['2001:db8::', 32], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8],
]
for (const [network, prefix] of V4_RANGES) blocked.addSubnet(network, prefix, 'ipv4')
for (const [network, prefix] of V6_RANGES) blocked.addSubnet(network, prefix, 'ipv6')

const MAPPED_V4 = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i

export function isPublicAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 4) return !blocked.check(address, 'ipv4')
  if (family !== 6) return false
  const mapped = MAPPED_V4.exec(address)
  if (mapped?.[1]) return isPublicAddress(mapped[1])
  // Any other IPv4-mapped/compatible form (e.g. ::ffff:7f00:1) is rejected outright.
  if (/^::ffff:/i.test(address)) return false
  return !blocked.check(address, 'ipv6')
}
