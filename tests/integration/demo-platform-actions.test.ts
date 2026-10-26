import { beforeAll, describe, expect, it } from 'vitest'
import { demoSignIn, demoSignOut, getDemoState } from '@/demo/demoStore'
import * as pl from '@/demo/demoPlatform'

const as = (email: string) => { demoSignOut(); demoSignIn(email, 'demo1234') }
const member = (biz: string, email: string) => getDemoState().members.find((m) => m.businessId === biz && m.email === email)!

beforeAll(() => { pl.resetDemoPlatform() })

describe('the demo console can edit, stop people, move ownership and delete, with the same rules as the database', () => {
  it('edits a business only for engineers and owners, with a reason and valid details', () => {
    as('support@demo.test')
    expect(pl.demoPlatformUpdateBusiness('b-farm', { name: 'Greenfield Ltd', legalName: '', timezone: 'Africa/Lagos', reason: 'rename' })).toMatch(/permission denied/)
    as('engineer@demo.test')
    expect(pl.demoPlatformUpdateBusiness('b-farm', { name: 'Greenfield Ltd', legalName: '', timezone: 'Africa/Lagos', reason: '' })).toMatch(/say why/)
    expect(pl.demoPlatformUpdateBusiness('b-farm', { name: '', legalName: '', timezone: 'Africa/Lagos', reason: 'rename' })).toMatch(/business name/)
    expect(pl.demoPlatformUpdateBusiness('b-farm', { name: 'Greenfield Ltd', legalName: 'Greenfield Limited', timezone: 'Mars/Base', reason: 'rename' })).toMatch(/time zone/)
    expect(pl.demoPlatformUpdateBusiness('b-farm', { name: 'Greenfield Ltd', legalName: 'Greenfield Limited', timezone: 'Africa/Accra', reason: 'Corrected the registered name' })).toBeNull()
    expect(pl.demoPlatformBusiness('b-farm')).toMatchObject({ name: 'Greenfield Ltd', legalName: 'Greenfield Limited', timezone: 'Africa/Accra' })
  })

  it('stops, restores and removes a member, but never the owner', () => {
    as('engineer@demo.test')
    expect(pl.demoPlatformSetMemberStatus('b-retail', 'u-cashier', 'suspended', 'Freeing a seat')).toBeNull()
    expect(member('b-retail', 'cashier@demo.test').status).toBe('suspended')
    expect(pl.demoPlatformSetMemberStatus('b-retail', 'u-cashier', 'active', 'Back at work')).toBeNull()
    expect(pl.demoPlatformSetMemberStatus('b-retail', 'u-cashier', 'revoked', 'Left')).toBeNull()
    expect(member('b-retail', 'cashier@demo.test').status).toBe('revoked')
    expect(pl.demoPlatformSetMemberStatus('b-retail', 'u-owner', 'suspended', 'mistake')).toMatch(/owns the business/)
    expect(pl.demoPlatformSetMemberStatus('b-retail', 'u-pharm', 'suspended', 'not a member')).toMatch(/not a member/)
    as('support@demo.test')
    expect(pl.demoPlatformSetMemberStatus('b-retail', 'u-acct', 'suspended', 'nope')).toMatch(/permission denied/)
  })

  it('moves ownership only for platform owners, only to an active member', () => {
    as('engineer@demo.test')
    expect(pl.demoPlatformTransferOwnership('b-retail', 'accountant@demo.test', 'agreed')).toMatch(/permission denied/)
    as('platform@demo.test')
    expect(pl.demoPlatformTransferOwnership('b-retail', 'accountant@demo.test', '')).toMatch(/say why/)
    expect(pl.demoPlatformTransferOwnership('b-retail', 'nobody@demo.test', 'agreed')).toMatch(/not an active member/)
    expect(pl.demoPlatformTransferOwnership('b-retail', 'cashier@demo.test', 'agreed')).toMatch(/not an active member/) // removed above
    expect(pl.demoPlatformTransferOwnership('b-retail', 'owner@demo.test', 'agreed')).toMatch(/already owns/)
    expect(pl.demoPlatformTransferOwnership('b-retail', 'accountant@demo.test', 'Owner retired')).toBeNull()
    expect(member('b-retail', 'accountant@demo.test').role).toBe('owner')
    expect(member('b-retail', 'owner@demo.test').role).toBe('business_admin')
  })

  it('deletes a business only for platform owners, and it then disappears from people', () => {
    as('engineer@demo.test')
    expect(pl.demoPlatformArchiveBusiness('b-bakery', 'closing')).toMatch(/permission denied/)
    as('platform@demo.test')
    expect(pl.demoPlatformArchiveBusiness('b-bakery', '')).toMatch(/say why/)
    expect(pl.demoPlatformArchiveBusiness('b-bakery', 'Owner asked us to close it')).toBeNull()
    expect(pl.demoPlatformBusinesses().find((b) => b.id === 'b-bakery')!.status).toBe('archived')
    expect(pl.demoPlatformArchiveBusiness('b-bakery', 'again')).toMatch(/business not found/)
    const log = pl.demoPlatformAudit()
    expect(log.map((l) => l.action)).toEqual(expect.arrayContaining(['business.update', 'member.suspended', 'business.transfer_ownership', 'business.archive']))
  })

  it('erases a business for good, only for platform owners, with the exact name and a reason', () => {
    as('engineer@demo.test')
    expect(pl.demoPlatformPurgeBusiness('b-pharmacy', 'CarePlus Pharmacy', 'erase')).toMatch(/permission denied/)
    as('platform@demo.test')
    expect(pl.demoPlatformPurgeBusiness('b-pharmacy', 'CarePlus Pharmacy', '')).toMatch(/say why/)
    expect(pl.demoPlatformPurgeBusiness('b-pharmacy', 'careplus', 'wrong name')).toMatch(/exactly/)
    expect(getDemoState().businesses.some((b) => b.id === 'b-pharmacy')).toBe(true)
    expect(pl.demoPlatformPurgeBusiness('b-pharmacy', 'CarePlus Pharmacy', 'Owner asked for permanent deletion')).toBeNull()
    // The pharmacist belonged only to the pharmacy and is gone; the cashier and the owner also belong elsewhere and stay.
    expect(getDemoState().users.some((u) => u.id === 'u-pharm')).toBe(false)
    expect(getDemoState().users.some((u) => u.id === 'u-cashier')).toBe(true)
    expect(getDemoState().users.some((u) => u.id === 'u-owner')).toBe(true)
    expect(getDemoState().businesses.some((b) => b.id === 'b-pharmacy')).toBe(false)
    expect(getDemoState().members.some((m) => m.businessId === 'b-pharmacy')).toBe(false)
    expect(pl.demoPlatformBusinesses().some((b) => b.id === 'b-pharmacy')).toBe(false)
    expect(pl.demoPlatformPurgeBusiness('b-pharmacy', 'CarePlus Pharmacy', 'again')).toMatch(/business not found/)
    const entry = pl.demoPlatformAudit().find((l) => l.action === 'business.purge')!
    expect(entry).toMatchObject({ business: 'CarePlus Pharmacy', reason: 'Owner asked for permanent deletion' })
  })
})
