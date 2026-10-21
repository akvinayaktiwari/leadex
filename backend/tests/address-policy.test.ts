import { describe, expect, it } from 'vitest'
import { isPublicAddress } from '../src/lib/address-policy.js'

describe('isPublicAddress', () => {
  // protects=the crawler can't be pointed at internal services, cloud metadata or loopback (SSRF);
  // fails_when=any private, loopback, link-local, CGNAT, multicast or IPv4-mapped private address is allowed;
  // no_claim=does not cover every IANA special-purpose block, only the ones that reach internal networks.
  it('rejects private and special-purpose addresses', () => {
    const blocked = ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255',
      '::1', '::', 'fe80::1', 'fd00::1', 'fc00::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', '::ffff:7f00:1', '64:ff9b::7f00:1', 'not-an-ip']
    for (const address of blocked) expect(isPublicAddress(address), address).toBe(false)
  })

  // protects=ordinary public websites stay reachable;
  // fails_when=the block list is so broad that public IPv4/IPv6 hosts are rejected;
  // no_claim=does not check reachability.
  it('allows public addresses', () => {
    for (const address of ['8.8.8.8', '104.21.3.4', '172.32.0.1', '2606:4700::6810:84e5', '::ffff:8.8.8.8']) {
      expect(isPublicAddress(address), address).toBe(true)
    }
  })
})
