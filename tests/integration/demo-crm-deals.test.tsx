import { renderToStaticMarkup } from 'react-dom/server'
import { beforeAll, describe, expect, it } from 'vitest'
import { getIndustry } from '@/core/industry-registry'
import { QuoteSheet } from '@/modules/crm/CrmQuotes'
import * as api from '@/modules/crm/dealsApi'
import * as demo from '@/demo/demoCrm'
import { demoCreateBusiness, demoSignIn, demoSignOut } from '@/demo/demoStore'
import { demoDeleteRecord } from '@/demo/demoDelete'

const as = (email: string) => { demoSignOut(); demoSignIn(email, 'demo1234') }
let biz: string, lead: string

beforeAll(async () => {
  as('owner@demo.test')
  biz = demoCreateBusiness('Consulting Co', 'general')
  await getIndustry('general').afterCreate?.(biz, {})
  demo.ensureDemoCrm(biz)
  lead = demo.getCrm().leads.find((l) => l.businessId === biz)!.id
})

const stageOf = (id: string) => demo.demoDeals(biz).find((d) => d.id === id)!.stage

describe('deals in the demo mirror', () => {
  it('start with the sample pipeline and accept new deals on a lead', () => {
    expect(demo.demoDeals(biz).length).toBe(2)
    expect(demo.demoSaveDeal(biz, { id: null, title: 'Fresh deal', customerId: null, leadId: lead, value: 1000, expectedClose: null, notes: '' })).toBeNull()
    const d = demo.demoDeals(biz).find((x) => x.title === 'Fresh deal')!
    expect(d.stage).toBe('new')
    expect(demo.demoDealEvents(biz, d.id)).toHaveLength(1)
  })

  it('check what they are given', () => {
    const save = (o: Partial<Parameters<typeof demo.demoSaveDeal>[1]>) => demo.demoSaveDeal(biz, { id: null, title: 'x', customerId: null, leadId: lead, value: 1, expectedClose: null, notes: '', ...o })
    expect(save({ title: ' ' })).toMatch(/enter what the deal is for/)
    expect(save({ leadId: null })).toMatch(/choose the customer or lead/)
    expect(save({ value: -1 })).toMatch(/cannot be negative/)
    expect(save({ leadId: 'nope' })).toMatch(/lead not found/)
  })

  it('move through stages, record each move, and need a reason to be lost', () => {
    const id = demo.demoDeals(biz)[0].id
    expect(demo.demoMoveDeal(biz, id, 'won', '')).toBeNull()
    expect(stageOf(id)).toBe('won'); expect(demo.demoDeals(biz).find((d) => d.id === id)!.closedAt).not.toBeNull()
    expect(demo.demoMoveDeal(biz, id, 'lost', ' ')).toMatch(/say why/)
    expect(demo.demoMoveDeal(biz, id, 'lost', 'Chose a competitor')).toBeNull()
    expect(demo.demoDeals(biz).find((d) => d.id === id)!.lostReason).toBe('Chose a competitor')
    expect(demo.demoMoveDeal(biz, id, 'new', '')).toBeNull()
    expect(demo.demoDeals(biz).find((d) => d.id === id)).toMatchObject({ lostReason: null, closedAt: null })
    expect(demo.demoDealEvents(biz, id).map((e) => e.to)).toEqual(['new', 'won', 'lost', 'new'])
  })

  it('are for people who manage customers', () => {
    as('viewer@demo.test')
    expect(demo.demoMoveDeal(biz, demo.demoDeals(biz)[0].id, 'won', '')).toMatch(/permission denied/)
    as('owner@demo.test')
  })
})

describe('quotes in the demo mirror', () => {
  const save = (o: Partial<Parameters<typeof demo.demoSaveQuote>[1]> = {}) => demo.demoSaveQuote(biz, { id: null, dealId: null, customerId: null, leadId: lead, validUntil: null, lines: [{ description: 'Design', quantity: 2, unitPrice: 1500.5 }], discount: 0, notes: '', ...o })

  it('are numbered and add up like the database', () => {
    expect(save({ lines: [{ description: 'Design', quantity: 2, unitPrice: 1500.5 }, { description: 'Hosting', quantity: 1, unitPrice: 999.99 }], discount: 100 })).toBeNull()
    expect(demo.demoQuotes(biz)[0]).toMatchObject({ number: 'QUO-000001', subtotal: 4000.99, total: 3900.99, status: 'draft' })
    expect(save()).toBeNull()
    expect(demo.demoQuotes(biz)[1].number).toBe('QUO-000002')
  })

  it('check the lines and the discount', () => {
    expect(save({ lines: [] })).toMatch(/at least one line/)
    expect(save({ lines: [{ description: '', quantity: 1, unitPrice: 1 }] })).toMatch(/needs a description/)
    expect(save({ lines: [{ description: 'A', quantity: 0, unitPrice: 1 }] })).toMatch(/quantity above zero/)
    expect(save({ discount: 99999 })).toMatch(/discount cannot be more/)
    expect(save({ leadId: null })).toMatch(/choose the customer, lead or deal/)
  })

  it('go draft, sent, then accepted or declined, and only a draft can be edited', () => {
    const id = demo.demoQuotes(biz)[1].id
    expect(demo.demoSetQuoteStatus(biz, id, 'accepted')).toMatch(/draft quote cannot be marked accepted/)
    expect(demo.demoSetQuoteStatus(biz, id, 'sent')).toBeNull()
    expect(save({ id })).toMatch(/can no longer be changed/)
    expect(demo.demoSetQuoteStatus(biz, id, 'accepted')).toBeNull()
    expect(demo.demoSetQuoteStatus(biz, id, 'declined')).toMatch(/accepted quote cannot be marked declined/)
  })

  it('print as a designed quote with the business, number, lines and total', () => {
    const q = demo.demoQuotes(biz)[0]
    const html = renderToStaticMarkup(<QuoteSheet quote={{ ...q, contact: 'Bola Supermarket', lines: q.lines } as api.QuoteRow} business="Consulting Co" />)
    for (const text of ['Consulting Co', 'QUO-000001', 'Bola Supermarket', 'Design', 'Hosting', 'Total', 'Authorised signature']) expect(html).toContain(text)
  })
})

describe('the report and deleting', () => {
  it('adds up the pipeline for one business', () => {
    const r = demo.demoCrmReport(biz)
    expect(r.stages.map((s) => s.stage)).toEqual(['new', 'qualified', 'proposal', 'negotiation', 'won', 'lost'])
    expect(r.openDeals).toBeGreaterThan(0)
    expect(r.winRate).toBeNull()
  })

  it('refuses to delete a lead that has a deal', () => {
    const r = demoDeleteRecord(biz, 'lead', lead)
    expect(String(r)).toMatch(/used by other records|cannot be deleted|archive/i)
    expect(demo.getCrm().leads.some((l) => l.id === lead)).toBe(true)
  })
})
