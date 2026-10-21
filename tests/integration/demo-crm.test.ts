import { beforeAll, describe, expect, it } from 'vitest'
import * as crm from '@/demo/demoCrm'
import { demoSignIn, demoSignOut } from '@/demo/demoStore'
import * as trade from '@/demo/demoTrade'

const B = 'b-retail'
const lead = (name: string) => crm.getCrm().leads.find((l) => l.businessId === B && l.name === name)!

beforeAll(() => {
  demoSignIn('owner@demo.test', 'demo1234')
  trade.ensureDemoTrade(B)
  crm.ensureDemoCrm(B)
})

describe('demo CRM follows the database rules', () => {
  it('converts a lead into a new customer, once', () => {
    expect(crm.demoCreateLead(B, { name: 'Fresh Lead', phone: '0900', email: 'fresh@example.com', source: 'ad', notes: '' })).toBeNull()
    const r = crm.demoConvertLead(B, lead('Fresh Lead').id)
    expect(r).toMatchObject({ error: null, created: true })
    expect(trade.getTrade().customers.some((c) => c.id === r.customerId)).toBe(true)
    expect(crm.demoConvertLead(B, lead('Fresh Lead').id).error).toMatch(/already converted/)
    expect(crm.demoSetLeadStatus(B, lead('Fresh Lead').id, 'new')).toMatch(/converted lead cannot change/)
  })

  it('reuses an existing customer with the same email (any case) instead of duplicating', () => {
    const before = trade.getTrade().customers.length
    crm.demoCreateLead(B, { name: 'Ada duplicate', phone: '', email: 'ADA@example.com', source: '', notes: '' })
    const r = crm.demoConvertLead(B, lead('Ada duplicate').id)
    expect(r.created).toBe(false)
    expect(trade.getTrade().customers.length).toBe(before)
  })

  it('does not allow marking a lead converted by hand', () => {
    crm.demoCreateLead(B, { name: 'Manual', phone: '', email: '', source: '', notes: '' })
    expect(crm.demoSetLeadStatus(B, lead('Manual').id, 'converted')).toMatch(/Use convert/)
  })

  it('carries notes and follow-ups to the customer on conversion', () => {
    crm.demoCreateLead(B, { name: 'Carry', phone: '', email: 'carry@example.com', source: '', notes: '' })
    const id = lead('Carry').id
    crm.demoAddInteraction(B, { leadId: id }, 'call', 'Asked for prices')
    crm.demoAddTask(B, { leadId: id }, 'Send quote', null)
    const { customerId } = crm.demoConvertLead(B, id)
    expect(crm.getCrm().interactions.some((i) => i.customerId === customerId && i.summary === 'Asked for prices')).toBe(true)
    expect(crm.getCrm().tasks.some((t) => t.customerId === customerId && t.title === 'Send quote')).toBe(true)
  })

  it('applies role permissions: a user without customers.manage cannot create leads', () => {
    demoSignOut()
    demoSignIn('accountant@demo.test', 'demo1234')
    expect(crm.demoCreateLead(B, { name: 'Nope', phone: '', email: '', source: '', notes: '' })).toBe('permission denied')
    demoSignOut()
  })
})
