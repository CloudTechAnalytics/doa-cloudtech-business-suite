import { beforeAll, describe, expect, it } from 'vitest'
import { demoSignIn, demoSignOut, getDemoState } from '@/demo/demoStore'
import * as pl from '@/demo/demoPlatform'

const as = (email: string) => { demoSignOut(); demoSignIn(email, 'demo1234') }
const statuses = (userId: string) => Object.fromEntries(getDemoState().members.filter((m) => m.userId === userId).map((m) => [m.businessId, m.status]))

beforeAll(() => { pl.resetDemoPlatform() })

describe('the platform Users page lists each person once, with every business they belong to', () => {
  it('returns one row per person, with their role and ownership in each business', () => {
    as('support@demo.test')
    const users = pl.demoPlatformUsers()
    expect(new Set(users.map((u) => u.id)).size).toBe(users.length)
    const cashier = pl.demoPlatformUser('u-cashier')
    expect(cashier.businesses.map((b) => b.businessId).sort()).toEqual(['b-pharmacy', 'b-retail'])
    expect(cashier.businesses.every((b) => b.role === 'cashier' && !b.isOwner)).toBe(true)
    expect(pl.demoPlatformUser('u-owner').businesses.filter((b) => b.businessId === 'b-retail')[0]).toMatchObject({ isOwner: true, role: 'owner' })
  })

  it('removes a person from one business without touching the others', () => {
    as('engineer@demo.test')
    expect(pl.demoPlatformSetMemberStatus('b-retail', 'u-cashier', 'revoked', 'Left the shop')).toBeNull()
    expect(statuses('u-cashier')).toMatchObject({ 'b-retail': 'revoked', 'b-pharmacy': 'active' })
  })

  it('removes a person from every business at once, keeps the account, needs a reason and write access', () => {
    as('support@demo.test')
    expect(pl.demoPlatformRemoveUserEverywhere('u-cashier', 'left')).toMatch(/permission denied/)
    as('engineer@demo.test')
    expect(pl.demoPlatformRemoveUserEverywhere('u-cashier', '')).toMatch(/say why/)
    expect(pl.demoPlatformSetMemberStatus('b-retail', 'u-cashier', 'active', 'Back')).toBeNull()
    expect(pl.demoPlatformRemoveUserEverywhere('u-cashier', 'Left the company')).toEqual({ removed: 2, keptOwned: null })
    expect(Object.values(statuses('u-cashier')).every((s) => s === 'revoked')).toBe(true)
    expect(getDemoState().users.some((u) => u.id === 'u-cashier')).toBe(true)
    expect(pl.demoPlatformAudit().filter((a) => a.action === 'member.revoked' && a.reason === 'Left the company')).toHaveLength(2)
  })

  it('never takes an owner out of a business they own', () => {
    as('engineer@demo.test')
    const owned = pl.demoPlatformUser('u-owner').businesses.filter((b) => b.status !== 'revoked' && b.businessStatus !== 'archived')
    expect(owned.every((b) => b.isOwner)).toBe(true)
    expect(pl.demoPlatformRemoveUserEverywhere('u-owner', 'mistake')).toMatch(/owns .*Transfer the ownership/)
    expect(Object.values(statuses('u-owner')).every((s) => s === 'active')).toBe(true)
  })
})
