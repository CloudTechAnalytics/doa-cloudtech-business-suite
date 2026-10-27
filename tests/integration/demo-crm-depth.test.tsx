import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { Body, monthLabel, sourceWinRate } from '@/modules/crm/CrmReports'
import { bucketOf } from '@/modules/crm/CrmActivities'
import { GettingStarted } from '@/modules/crm/CrmDeals'
import { ContactActions, mailUrl, phoneDigits, telUrl, whatsappUrl } from '@/modules/crm/ContactActions'
import { IMPORT_TEMPLATE, mapHeaders, parseCsv, toCsv, toImportRows } from '@/modules/crm/csv'
import * as api from '@/modules/crm/dealsApi'
import * as demo from '@/demo/demoCrm'
import { demoCreateBusiness, demoSignIn, demoSignOut } from '@/demo/demoStore'
import { demoCreateCustomer, getTrade } from '@/demo/demoTrade'
import { setDemoPlanLimits } from '@/demo/demoUsage'

const as = (email: string) => { demoSignOut(); demoSignIn(email, 'demo1234') }
let n = 0
const workspace = () => demoCreateBusiness(`CRM ${n++}`, 'general')
const stage = (b: string, name: string) => demo.demoStageList(b).find((s) => s.name === name)!
const customer = (b: string, name = `C${n++}`) => { demoCreateCustomer(b, name, `08${n++}`); return getTrade().customers.find((x) => x.businessId === b && x.name === name)!.id }
const deal = (b: string, title = `D${n++}`, value = 1000) => { const c = customer(b); demo.demoSaveDeal(b, { id: null, title, customerId: c, leadId: null, value, expectedClose: null, ownerId: null, notes: '' }); return demo.demoDeals(b).find((d) => d.title === title)!.id }

beforeAll(() => { as('owner@demo.test') })
afterEach(() => setDemoPlanLimits('starter', {}))

describe('stages in the demo mirror', () => {
  it('start with the six usual stages, can be added, renamed, reordered and removed under the same rules as the database', () => {
    const b = workspace()
    expect(demo.demoStageList(b).map((s) => `${s.name}:${s.probability}:${s.kind}`)).toEqual(['New:10:open', 'Qualified:25:open', 'Proposal:50:open', 'Negotiation:75:open', 'Won:100:won', 'Lost:0:lost'])
    expect(demo.demoSaveStage(b, { id: null, name: 'Site visit', probability: 40 })).toBeNull()
    expect(demo.demoStageList(b).map((s) => s.name)).toEqual(['New', 'Qualified', 'Proposal', 'Negotiation', 'Site visit', 'Won', 'Lost'])
    expect(demo.demoSaveStage(b, { id: null, name: ' site visit ', probability: 10 })).toMatch(/already a stage with this name/)
    expect(demo.demoSaveStage(b, { id: null, name: ' ', probability: 10 })).toMatch(/enter a name/)
    expect(demo.demoSaveStage(b, { id: null, name: 'X', probability: 101 })).toMatch(/between 0 and 100/)
    const won = stage(b, 'Won'); expect(demo.demoSaveStage(b, { id: won.id, name: 'Closed won', probability: 5 })).toBeNull()
    expect(stage(b, 'Closed won')).toMatchObject({ probability: 100, kind: 'won' })
    const open = demo.demoStageList(b).filter((s) => s.kind === 'open').map((s) => s.id)
    expect(demo.demoReorderStages(b, [...open].reverse())).toBeNull()
    expect(demo.demoStageList(b).filter((s) => s.kind === 'open')[0].name).toBe('Site visit')
    expect(demo.demoReorderStages(b, open.slice(1))).toMatch(/every open stage once/)
  })

  it('cannot be removed with deals in them, nor Won or Lost, nor the last open stage', () => {
    const b = workspace(); deal(b)
    expect(demo.demoDeleteStage(b, stage(b, 'New').id)).toMatch(/move the deals out of this stage/)
    expect(demo.demoDeleteStage(b, stage(b, 'Won').id)).toMatch(/always part of the pipeline/)
    for (const name of ['Negotiation', 'Qualified', 'Proposal']) expect(demo.demoDeleteStage(b, stage(b, name).id)).toBeNull()
    expect(demo.demoDeleteStage(b, stage(b, 'New').id)).toMatch(/move the deals|at least one open stage/)
  })

  it('are for people who manage customers, and per business', () => {
    const b = workspace(); const other = workspace()
    as('viewer@demo.test'); expect(demo.demoSaveStage(b, { id: null, name: 'Nope', probability: 1 })).toMatch(/permission denied/); as('owner@demo.test')
    demo.demoSaveStage(other, { id: null, name: 'Only there', probability: 1 })
    expect(demo.demoStageList(b).map((s) => s.name)).not.toContain('Only there')
  })
})

describe('deals, activities and leads in the demo mirror', () => {
  it('start in the first open stage with the creator as owner, and moving one records the stage names', () => {
    const b = workspace(); const id = deal(b)
    expect(demo.demoDeals(b).find((d) => d.id === id)).toMatchObject({ stageKind: 'open', stageId: stage(b, 'New').id })
    expect(demo.demoMoveDeal(b, id, stage(b, 'Proposal').id, '')).toBeNull()
    expect(demo.demoDealEvents(b, id).map((e) => `${e.from}>${e.to}`)).toEqual(['null>New', 'New>Proposal'])
    expect(demo.demoSetNextStep(b, id, 'Send the proposal')).toBeNull()
    expect(demo.demoDeals(b).find((d) => d.id === id)!.nextStep).toBe('Send the proposal')
    expect(demo.demoSetNextStep(b, id, 'x'.repeat(301))).toMatch(/too long/)
  })

  it('activities can be calls, meetings, emails or to-dos on a deal, finish with an outcome, and be moved', () => {
    const b = workspace(); const id = deal(b)
    expect(demo.demoAddTask(b, { dealId: id }, 'Call about the deal', '2031-01-01T10:00:00Z', 'call')).toBeNull()
    expect(demo.demoAddTask(b, {}, 'Floating')).toMatch(/choose who or what/)
    expect(demo.demoAddTask(b, { dealId: id }, 'Bad', null, 'fax' as 'call')).toMatch(/choose a type/)
    const t = demo.getCrm().tasks.find((x) => x.dealId === id)!
    expect(demo.demoRescheduleTask(b, t.id, '2031-02-02T10:00:00Z')).toBeNull(); expect(demo.getCrm().tasks.find((x) => x.id === t.id)!.dueAt).toBe('2031-02-02T10:00:00Z')
    expect(demo.demoSetTaskStatus(b, t.id, 'done', 'Agreed on price')).toBeNull()
    expect(demo.getCrm().tasks.find((x) => x.id === t.id)).toMatchObject({ status: 'done', outcome: 'Agreed on price' })
    expect(demo.getCrm().tasks.find((x) => x.id === t.id)!.completedAt).not.toBeNull()
  })

  it('a lead can be rated and given an owner who is on the business', () => {
    const b = workspace(); demo.ensureDemoCrm(b); const lead = demo.getCrm().leads.find((l) => l.businessId === b)!.id
    const me = demo.demoTeam(b)[0].userId
    expect(demo.demoSetLeadMeta(b, lead, { rating: 'hot', ownerId: me })).toBeNull(); expect(demo.getCrm().leads.find((l) => l.id === lead)).toMatchObject({ rating: 'hot', ownerId: me })
    expect(demo.demoSetLeadMeta(b, lead, { rating: 'lukewarm' as 'hot', ownerId: null })).toMatch(/hot, warm or cold/)
    expect(demo.demoSetLeadMeta(b, lead, { rating: null, ownerId: 'u-nobody' })).toMatch(/not on this business/)
  })
})

describe('import in the demo mirror', () => {
  it('adds customers and leads, skips duplicates by email or phone, and reports rows it cannot read', () => {
    const b = workspace(); demo.ensureDemoCrm(b)
    demoCreateCustomer(b, 'Existing', '0801'); const old = getTrade().customers.find((c) => c.businessId === b && c.name === 'Existing')!; old.email = 'old@example.com'
    const r = demo.demoImport(b, 'customers', [{ name: 'Ada Obi', phone: '0803', email: 'ADA@example.com', company: 'Obi Stores' }, { name: 'Ada again', email: 'ada@example.com' }, { name: 'Old', email: 'OLD@example.com' }, { name: 'Phone dup', phone: '0801' }, { name: '', phone: '0805' }, { name: 'Bad mail', email: 'nope' }, { name: 'Bola', phone: '0806' }])
    expect(r.error).toBeNull(); expect(r.result!.created).toBe(2); expect(r.result!.duplicates).toEqual([2, 3, 4]); expect(r.result!.invalid).toEqual([{ row: 5, reason: 'no name' }, { row: 6, reason: 'email is not valid' }])
    const leads = demo.demoImport(b, 'leads', [{ name: 'Lead one', email: 'l1@example.com' }, { name: 'Ada Obi', email: 'ada@example.com' }])
    expect(leads.result!.created).toBe(1); expect(leads.result!.duplicates).toEqual([2])
  })

  it('is refused when empty, oversized or not allowed, and a plan limit imports nothing', () => {
    const b = workspace()
    expect(demo.demoImport(b, 'customers', []).error).toMatch(/no rows to import/)
    expect(demo.demoImport(b, 'customers', Array.from({ length: 501 }, (_, i) => ({ name: `P${i}` }))).error).toMatch(/at most 500/)
    as('viewer@demo.test'); expect(demo.demoImport(b, 'customers', [{ name: 'x' }]).error).toMatch(/permission denied/); as('owner@demo.test')
    setDemoPlanLimits('starter', { customers: 3 })
    const c = workspace(); customer(c)
    expect(demo.demoImport(c, 'customers', [{ name: 'Two' }, { name: 'Three' }, { name: 'Four' }]).error).toMatch(/plan limit reached/)
    expect(getTrade().customers.filter((x) => x.businessId === c)).toHaveLength(1)
  })
})

describe('the richer report in the demo mirror', () => {
  it('shows the weighted forecast, owners, lead sources and quiet deals', () => {
    const b = workspace(); demo.ensureDemoCrm(b)
    const r = demo.demoCrmReport(b)
    expect(r.stages.map((s) => s.stage)).toEqual(['New', 'Qualified', 'Proposal', 'Negotiation', 'Won', 'Lost'])
    expect(r.weightedValue).toBe(450000 * 0.5 + 120000 * 0.1) // the sample Proposal and New deals
    expect(r.bySource.map((s) => s.source).sort()).toEqual(['instagram', 'referral'])
    expect(r.byOwner.length).toBeGreaterThan(0)
    const id = r.stages.find((s) => s.stage === 'Proposal') && demo.demoDeals(b).find((d) => d.title.startsWith('Weekly'))!.id
    demo.mutateCrm((s) => ({ ...s, deals: s.deals.map((d) => (d.id === id ? { ...d, lastMovedAt: new Date(Date.now() - 30 * 86400000).toISOString() } : d)) }))
    expect(demo.demoCrmReport(b).staleDeals).toBe(1)
    demo.demoAddInteraction(b, { dealId: id }, 'call', 'Rang them')
    expect(demo.demoCrmReport(b).staleDeals).toBe(0)
  })
})

describe('screen logic', () => {
  it('reads CSV with quotes, doubled quotes, semicolons, a byte-order mark and blank lines', () => {
    expect(parseCsv('﻿Name,Phone\r\n"Obi, Ada","08""3"\r\n\r\nBola,0806\r\n')).toEqual([['Name', 'Phone'], ['Obi, Ada', '08"3'], ['Bola', '0806']])
    expect(parseCsv('Name;Phone\nAda;0803')).toEqual([['Name', 'Phone'], ['Ada', '0803']])
    expect(toCsv([['a,b', 'c"d', null, 5]])).toBe('"a,b","c""d",,5')
  })

  it('matches column headings to fields however they are written, ignores the rest, and needs a name column', () => {
    expect(mapHeaders(['Full Name', 'Mobile', 'E-mail', 'Organisation', 'Favourite colour']).map).toEqual({ name: 0, phone: 1, email: 2, company: 3 })
    expect(mapHeaders(['Full Name', 'Favourite colour']).ignored).toEqual(['Favourite colour'])
    expect(toImportRows([['Phone', 'Email'], ['0803', 'a@b.co']]).missingName).toBe(true)
    const ok = toImportRows(parseCsv('Customer Name,Phone Number,City\nAda,0803,Lagos\nBola,0806,Abuja'))
    expect(ok.rows).toMatchObject([{ name: 'Ada', phone: '0803', city: 'Lagos' }, { name: 'Bola', phone: '0806', city: 'Abuja' }])
    expect(toImportRows(parseCsv(toCsv(IMPORT_TEMPLATE))).rows[0]).toMatchObject({ name: 'Ada Obi', email: 'ada@example.com', company: 'Obi Stores' })
  })

  it('makes call, WhatsApp and email links, writing Nigerian numbers the international way', () => {
    expect(phoneDigits('0803 123 4567')).toBe('2348031234567'); expect(phoneDigits('+234 803 123 4567')).toBe('2348031234567')
    expect(telUrl('0803 123 4567')).toBe('tel:08031234567')
    expect(whatsappUrl('0803 123 4567', 'Hello Ada')).toBe('https://wa.me/2348031234567?text=Hello%20Ada')
    expect(mailUrl('ada@example.com', 'Quote', 'Hi')).toBe('mailto:ada@example.com?subject=Quote&body=Hi')
    const both = renderToStaticMarkup(<ContactActions name="Ada" phone="0803" email="a@b.co" />)
    expect(both).toContain('Call Ada'); expect(both).toContain('WhatsApp Ada'); expect(both).toContain('Email Ada')
    const phoneOnly = renderToStaticMarkup(<ContactActions name="Ada" phone="0803" email={null} />)
    expect(phoneOnly).not.toContain('Email Ada'); expect(renderToStaticMarkup(<ContactActions name="Ada" phone={null} email={null} />)).toBe('')
  })

  it('guides a new CRM through four steps, with buttons only for people who can add things', () => {
    const html = renderToStaticMarkup(<GettingStarted manage onGo={() => {}} onAddDeal={() => {}} />)
    for (const t of ['Get your CRM going', 'Bring in your contacts', 'Capture your leads', 'Create a deal', 'Plan your follow-ups', 'Add or import customers', 'Add your first deal']) expect(html).toContain(t)
    expect(renderToStaticMarkup(<GettingStarted manage={false} onGo={() => {}} onAddDeal={() => {}} />)).not.toContain('Add your first deal')
  })

  it('puts activities in overdue, today, coming up or no date', () => {
    const now = new Date('2031-05-10T12:00:00')
    expect([bucketOf('2031-05-09T09:00:00', now), bucketOf('2031-05-10T18:00:00', now), bucketOf('2031-05-11T09:00:00', now), bucketOf(null, now)]).toEqual(['overdue', 'today', 'upcoming', 'undated'])
  })

  it('labels forecast months and works out the win rate of a lead source', () => {
    expect(monthLabel('2031-03')).toMatch(/Mar 2031/); expect(monthLabel('none')).toBe('No close date')
    expect([sourceWinRate({ deals: 4, won: 1 }), sourceWinRate({ deals: 0, won: 0 })]).toEqual([25, null])
  })

  it('shows the report: the likely-to-close figure, the funnel, the forecast, owners and sources', () => {
    const html = renderToStaticMarkup(<Body d={{
      stages: [{ id: 'a', stage: 'New', kind: 'open', probability: 10, deals: 2, value: 200 }, { id: 'b', stage: 'Won', kind: 'won', probability: 100, deals: 1, value: 500 }], openValue: 200, openDeals: 2, weightedValue: 20, wonThisMonth: 500, wonDealsThisMonth: 1, winRate: 50, avgCycleDays: 12.5,
      leads: { new: 3 }, overdueTasks: 1, dueToday: 2, activitiesDone30d: 7, staleDeals: 1, lostReasons: [{ reason: 'Price', deals: 1 }], forecast: [{ month: '2031-03', deals: 2, value: 200, weighted: 20 }],
      byOwner: [{ owner: 'Ada', openDeals: 2, openValue: 200, wonThisMonth: 500 }], bySource: [{ source: 'instagram', leads: 3, deals: 2, won: 1, wonValue: 500 }] } as api.CrmReport} />)
    for (const t of ['Likely to close', 'Pipeline funnel', 'Forecast by month', 'By owner', 'Which lead sources turn into sales', 'Gone quiet', '12.5 days to win', 'instagram', 'Price']) expect(html).toContain(t)
  })
})
