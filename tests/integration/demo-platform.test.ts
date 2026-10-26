import { beforeAll, describe, expect, it } from 'vitest'
import { getDemoState, demoSignIn, demoSignOut, demoSignUp } from '@/demo/demoStore'
import * as pl from '@/demo/demoPlatform'

const as = (email: string) => { demoSignOut(); demoSignIn(email, 'demo1234') }

beforeAll(() => { pl.resetDemoPlatform() })

describe('the demo platform console follows the database rules', () => {
  it('knows the platform team by role and nobody else', () => {
    as('platform@demo.test'); expect(pl.demoPlatformRole()).toBe('owner')
    as('engineer@demo.test'); expect(pl.demoPlatformRole()).toBe('engineer')
    as('support@demo.test'); expect(pl.demoPlatformRole()).toBe('support')
    as('owner@demo.test'); expect(pl.demoPlatformRole()).toBeNull()
  })

  it('keeps every function closed to business owners', () => {
    as('owner@demo.test')
    expect(() => pl.demoPlatformOverview()).toThrow(/permission denied/)
    expect(() => pl.demoPlatformBusinesses()).toThrow(/permission denied/)
    expect(() => pl.demoPlatformUsers()).toThrow(/permission denied/)
    expect(pl.demoPlatformSetBusinessStatus('b-farm', 'suspended', 'no right')).toMatch(/permission denied/)
    expect(pl.demoPlatformSetSubscription('b-farm', { plan: 'growth', status: null, extendDays: null, reason: 'no right' })).toMatch(/permission denied/)
  })

  it('shows the businesses, who owns them and what they pay', () => {
    as('support@demo.test')
    const o = pl.demoPlatformOverview()
    expect(o.businesses).toBe(5); expect(o.paid).toBe(2); expect(o.trial).toBe(3); expect(o.platformTeam).toBe(3)
    expect(o.mrr).toBe(30000) // two businesses on the Growth plan
    expect(o.trialsEnding.map((t) => t.name)).toContain('CityMart')
    const rows = pl.demoPlatformBusinesses('owner@demo')
    expect(rows).toHaveLength(5); expect(rows[0].ownerEmail).toBe('owner@demo.test')
    expect(pl.demoPlatformBusinesses('sunrise').map((b) => b.name)).toEqual(['Sunrise Bakery'])
    expect(pl.demoPlatformBusiness('b-school').members.map((m) => m.role)).toEqual(expect.arrayContaining(['owner', 'teacher', 'parent']))
    expect(() => pl.demoPlatformBusiness('nope')).toThrow(/business not found/)
  })

  it('lets support look but not change, and an engineer change with a reason', () => {
    as('support@demo.test')
    expect(pl.demoPlatformSetSubscription('b-bakery', { plan: 'basic', status: null, extendDays: null, reason: 'Asked to' })).toMatch(/permission denied/)
    as('engineer@demo.test')
    expect(pl.demoPlatformSetSubscription('b-bakery', { plan: 'basic', status: null, extendDays: null, reason: '' })).toMatch(/say why/)
    expect(pl.demoPlatformSetSubscription('b-bakery', { plan: 'basic', status: 'active', extendDays: null, reason: 'Paid by transfer' })).toBeNull()
    expect(getDemoState().modules['b-bakery'].plan).toBe('basic')
    const o = pl.demoPlatformOverview()
    expect(o.paid).toBe(3); expect(o.mrr).toBe(35000)
  })

  it('extends a trial from where it ends and refuses silly values', () => {
    as('engineer@demo.test')
    const before = pl.demoPlatformBusiness('b-retail').subscription!.trialEnd!
    expect(pl.demoPlatformSetSubscription('b-retail', { plan: null, status: null, extendDays: 7, reason: 'Needs time' })).toBeNull()
    const after = pl.demoPlatformBusiness('b-retail').subscription!.trialEnd!
    expect(Math.round((new Date(after).getTime() - new Date(before).getTime()) / 86400000)).toBe(7)
    expect(pl.demoPlatformSetSubscription('b-retail', { plan: null, status: null, extendDays: 0, reason: 'zero' })).toMatch(/1 to 366/)
  })

  it('suspends a business so its people lose it, and reactivates it', () => {
    as('engineer@demo.test')
    expect(pl.demoPlatformSetBusinessStatus('b-pharmacy', 'suspended', 'Unpaid invoice')).toBeNull()
    expect(getDemoState().businesses.find((b) => b.id === 'b-pharmacy')!.suspended).toBe(true)
    expect(pl.demoPlatformOverview().suspended).toBe(1)
    expect(pl.demoPlatformSetBusinessStatus('b-pharmacy', 'active', 'Paid')).toBeNull()
    expect(getDemoState().businesses.find((b) => b.id === 'b-pharmacy')!.suspended).toBe(false)
  })

  it('logs each change with who and why', () => {
    as('support@demo.test')
    const log = pl.demoPlatformAudit()
    expect(log.map((l) => l.action)).toEqual(expect.arrayContaining(['subscription.update', 'business.suspend', 'business.reactivate']))
    expect(log.find((l) => l.action === 'business.suspend')).toMatchObject({ by: 'engineer@demo.test', reason: 'Unpaid invoice', business: 'CarePlus Pharmacy' })
  })

  it('lets only an owner change the team, and always keeps one owner', () => {
    as('engineer@demo.test')
    expect(pl.demoPlatformAddAdmin('owner@demo.test', 'support')).toMatch(/permission denied/)
    as('platform@demo.test')
    expect(pl.demoPlatformAddAdmin('nobody@demo.test', 'support')).toMatch(/sign up first/)
    expect(pl.demoPlatformAddAdmin('owner@demo.test', 'support')).toBeNull()
    expect(pl.demoPlatformAdmins().map((a) => a.email)).toContain('owner@demo.test')
    expect(pl.demoPlatformRemoveAdmin('u-platform')).toMatch(/at least one platform owner/)
    expect(pl.demoPlatformAddAdmin('platform@demo.test', 'engineer')).toMatch(/at least one platform owner/)
    expect(pl.demoPlatformRemoveAdmin('u-owner')).toBeNull()
    expect(demoSignUp('New Person', 'fresh@demo.test', 'demo1234')).toBeNull()
  })
})
