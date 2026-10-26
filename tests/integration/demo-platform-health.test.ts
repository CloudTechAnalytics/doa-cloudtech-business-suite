import { describe, expect, it } from 'vitest'
import { demoSignIn, demoSignOut } from '@/demo/demoStore'
import { demoPlatformUsage } from '@/demo/demoPlatform'
import { probeServices } from '@/core/platform-admin/platformApi'

describe('the demo System Health page', () => {
  it('is closed to business owners and open to the platform team', () => {
    demoSignOut(); demoSignIn('owner@demo.test', 'demo1234')
    expect(() => demoPlatformUsage()).toThrow(/permission denied/)
    demoSignOut(); demoSignIn('support@demo.test', 'demo1234')
    const u = demoPlatformUsage()
    expect(u.businesses).toBe(5); expect(u.users).toBeGreaterThanOrEqual(8)
    expect(u.databaseCapBytes).toBe(500 * 1024 * 1024); expect(u.storageCapBytes).toBe(1024 * 1024 * 1024)
  })

  it('times the services it can reach and reports each as answering', async () => {
    const checks = await probeServices()
    expect(checks.map((c) => c.key)).toEqual(['db', 'auth'])
    for (const c of checks) { expect(c.ok).toBe(true); expect(c.ms).not.toBeNull() }
  })
})
