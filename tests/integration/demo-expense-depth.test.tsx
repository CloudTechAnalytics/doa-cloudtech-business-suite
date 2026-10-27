import { beforeAll, describe, expect, it } from 'vitest'
import { buildApps, sidebarEntries } from '@/app/navigation/navigation'
import { getIndustry } from '@/core/industry-registry'
import * as fin from '@/demo/demoFinance'
import { demoCreateBusiness, demoSignIn, demoSignOut } from '@/demo/demoStore'
import { budgetStatus, expenseReport, recordExpense, setBudget, voidExpense } from '@/modules/finance/financeApi'
import type { ExpenseDto } from '@/modules/finance/financeApi'
import { budgetTotals, categoryChoices, expensesExport, filterExpenses, periodFor, reportExport, shiftMonth, toSlug, usage } from '@/modules/finance/expenseLogic'

const as = (email: string) => { demoSignOut(); demoSignIn(email, 'demo1234') }
let biz: string
let n = 0
const key = () => `dexp-${Date.now()}-${n++}-abcdefgh`
const today = new Date().toISOString().slice(0, 10)
const month = `${today.slice(0, 7)}-01`
const spend = (category: string, amount: number, date = today, method = 'cash') => fin.demoRecordExpense(biz, { category, amount, method, description: `Spend on ${category}`, date, supplierId: null, batchId: null }, key())

beforeAll(async () => {
  as('owner@demo.test')
  biz = demoCreateBusiness('Consulting Co', 'general')
  await getIndustry('general').afterCreate?.(biz, {})
})

describe('categories in the demo mirror', () => {
  it('accepts any short lower-case name and refuses what is not one, like the database', () => {
    expect(spend('marketing', 100).error).toBeNull(); expect(spend('staff_welfare', 50).error).toBeNull()
    for (const bad of ['Marketing', 'a', '1abc', 'has space', 'x'.repeat(41), '']) expect(spend(bad, 5).error).toMatch(/choose a category/)
  })
})

describe('budgets in the demo mirror', () => {
  it('put the monthly budget next to what was spent, voided entries left out, and list spending with no budget', async () => {
    expect(await setBudget(biz, 'transport', 1000)).toBeNull()
    const a = spend('transport', 300).result!.expenseId; spend('transport', 200); spend('rent', 800)
    expect(fin.demoVoidExpense(biz, a, 'Entered twice', key())).toBeNull()
    const s = await budgetStatus(biz, month)
    expect(s.month).toBe(month)
    expect(s.rows.find((r) => r.category === 'transport')).toEqual({ category: 'transport', budget: 1000, spent: 200 })
    expect(s.rows.find((r) => r.category === 'rent')).toEqual({ category: 'rent', budget: null, spent: 800 })
  })
  it('apply to every month, and each month shows only its own spending', async () => {
    const d = new Date(`${month}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - 1)
    const date = d.toISOString().slice(0, 10)
    spend('transport', 150, date)
    const s = await budgetStatus(biz, date)
    expect(s.rows.find((r) => r.category === 'transport')).toEqual({ category: 'transport', budget: 1000, spent: 150 })
    expect(s.rows.find((r) => r.category === 'rent')).toBeUndefined()
  })
  it('can be changed and removed (zero or nothing removes)', async () => {
    await setBudget(biz, 'transport', 1500); expect((await budgetStatus(biz, month)).rows.find((r) => r.category === 'transport')!.budget).toBe(1500)
    await setBudget(biz, 'transport', null); expect((await budgetStatus(biz, month)).rows.find((r) => r.category === 'transport')!.budget).toBeNull()
  })
  it('refuse a negative amount or a bad category, and are closed to a role that cannot record or read', async () => {
    expect(await setBudget(biz, 'transport', -5)).toMatch(/negative/); expect(await setBudget(biz, 'Bad Name', 5)).toMatch(/choose a category/)
    as('teacher@demo.test')
    expect(await setBudget(biz, 'transport', 100)).toMatch(/permission denied/); await expect(budgetStatus(biz, month)).rejects.toThrow(/permission denied/)
    as('owner@demo.test')
  })
})

describe('the spending report in the demo mirror', () => {
  it('adds up a period by category, month, payment method and supplier, leaving out voided entries', async () => {
    const b = demoCreateBusiness('Report Co', 'general'); await getIndustry('general').afterCreate?.(b, {})
    const put = (category: string, amount: number, method: string) => fin.demoRecordExpense(b, { category, amount, method, description: `x ${category}`, date: today, supplierId: null, batchId: null }, key())
    put('fuel_energy', 400, 'cash'); put('fuel_energy', 100, 'bank_transfer'); put('rent', 1000, 'bank_transfer')
    const gone = put('rent', 777, 'cash').result!.expenseId; fin.demoVoidExpense(b, gone, 'Wrong entry', key())
    const r = await expenseReport(b, month, today)
    expect(r).toMatchObject({ total: 1500, count: 3 })
    expect(r.byCategory).toEqual([{ category: 'rent', total: 1000, count: 1 }, { category: 'fuel_energy', total: 500, count: 2 }])
    expect(r.byMonth).toEqual([{ month: today.slice(0, 7), total: 1500 }])
    expect(r.byMethod).toEqual([{ method: 'bank_transfer', total: 1100 }, { method: 'cash', total: 400 }])
    expect(r.bySupplier).toEqual([])
  })
  it('is empty for a quiet period, refuses a backwards one, and is closed to a role that cannot read', async () => {
    expect(await expenseReport(biz, '2001-01-01', '2001-12-31')).toMatchObject({ total: 0, count: 0, byCategory: [] })
    await expect(expenseReport(biz, today, '2001-01-01')).rejects.toThrow(/valid period/)
    as('teacher@demo.test'); await expect(expenseReport(biz, month, today)).rejects.toThrow(/permission denied/); as('owner@demo.test')
  })
  it('still records through the API and voids through it', async () => {
    expect(await recordExpense(biz, { category: 'software', amount: 25, method: 'card', description: 'Licence', date: today, supplierId: null, batchId: null }, key())).toBeNull()
    const id = fin.getFinance().expenses.find((e) => e.businessId === biz && e.category === 'software')!.id
    expect(await voidExpense(biz, id, 'Entered twice', key())).toBeNull()
  })
})

describe('what the expense screens work out', () => {
  it('turns a typed name into a category, or nothing when none is possible', () => {
    expect(toSlug('Staff welfare')).toBe('staff_welfare'); expect(toSlug('  Bank & card charges! ')).toBe('bank_card_charges'); expect(toSlug('a')).toBe(''); expect(toSlug('123')).toBe(''); expect(toSlug('€€€')).toBe('')
    expect(toSlug('x'.repeat(60)).length).toBe(40)
  })
  it('offers the farm set to a farm and a general set to anyone else, plus what was already used, with Other last', () => {
    const farm = categoryChoices('farm'); const shop = categoryChoices('retail', ['staff_welfare'])
    expect(farm).toContain('feed'); expect(farm).not.toContain('marketing'); expect(shop).toContain('marketing'); expect(shop).not.toContain('feed'); expect(shop).toContain('staff_welfare')
    expect(farm.at(-1)).toBe('other'); expect(shop.at(-1)).toBe('other')
    expect(new Set(shop).size).toBe(shop.length)
  })
  it('keeps a category that was used even if it is not in the set', () => { expect(categoryChoices('farm', ['marketing'])).toContain('marketing') })
  it('works out how much of a budget is used: near at 80%, over above 100%, nothing without a budget', () => {
    expect(usage(1000, 500)).toEqual({ pct: 50, state: 'ok' }); expect(usage(1000, 800)).toMatchObject({ state: 'near' }); expect(usage(1000, 1000)).toMatchObject({ pct: 100, state: 'near' })
    expect(usage(1000, 1001)).toMatchObject({ state: 'over' }); expect(usage(null, 500)).toEqual({ pct: 0, state: 'none' }); expect(usage(0, 5).state).toBe('none')
  })
  it('totals budgets: what was budgeted, spent against it, what is left, what had no budget, and how many are over', () => {
    const t = budgetTotals([{ category: 'a', budget: 1000, spent: 1200 }, { category: 'b', budget: 500, spent: 100 }, { category: 'c', budget: null, spent: 300 }])
    expect(t).toEqual({ budgeted: 1500, spentOnBudgeted: 1300, remaining: 200, unbudgetedSpend: 300, overCount: 1 })
  })
  it('moves a month by whole months, across a year end', () => {
    expect(shiftMonth('2031-01-15', -1)).toBe('2030-12-01'); expect(shiftMonth('2031-12-01', 1)).toBe('2032-01-01'); expect(shiftMonth('2031-03-01', 0)).toBe('2031-03-01')
  })
  it('works out the period a preset means', () => {
    expect(periodFor('this_month', '2031-03-17')).toEqual({ from: '2031-03-01', to: '2031-03-17' })
    expect(periodFor('last_month', '2031-03-17')).toEqual({ from: '2031-02-01', to: '2031-02-28' })
    expect(periodFor('last_month', '2031-01-05')).toEqual({ from: '2030-12-01', to: '2030-12-31' })
    expect(periodFor('this_year', '2031-03-17')).toEqual({ from: '2031-01-01', to: '2031-03-17' })
    expect(periodFor('last_30', '2031-03-17')).toEqual({ from: '2031-02-16', to: '2031-03-17' })
  })
  const e = (id: string, o: Partial<ExpenseDto> = {}): ExpenseDto => ({ id, number: `EXP-${id}`, category: 'rent', amount: 100, method: 'cash', description: 'Shop rent', date: '2031-03-01', supplierId: null, batchId: null, source: 'manual', status: 'posted', voidReason: null, ...o })
  it('filters the list by words, category, how it was paid, dates and status', () => {
    const list = [e('1'), e('2', { category: 'marketing', description: 'Flyers', method: 'card', date: '2031-03-10' }), e('3', { status: 'voided', voidReason: 'oops', date: '2031-04-01' })]
    expect(filterExpenses(list, { q: 'flyer' }).map((x) => x.id)).toEqual(['2']); expect(filterExpenses(list, { q: 'marketing' }).map((x) => x.id)).toEqual(['2'])
    expect(filterExpenses(list, { category: 'rent' }).map((x) => x.id)).toEqual(['1', '3']); expect(filterExpenses(list, { method: 'card' }).map((x) => x.id)).toEqual(['2'])
    expect(filterExpenses(list, { from: '2031-03-05', to: '2031-03-31' }).map((x) => x.id)).toEqual(['2']); expect(filterExpenses(list, { status: 'voided' }).map((x) => x.id)).toEqual(['3'])
    expect(filterExpenses(list, { status: 'all' })).toHaveLength(3)
  })
  it('exports the list and the report', () => {
    const csv = expensesExport([e('1', { supplierId: 's' }), e('2', { status: 'voided', voidReason: 'oops' })], (id) => (id ? 'Fuel Depot' : undefined))
    expect(csv[0][0]).toBe('Number'); expect(csv[1]).toEqual(['EXP-1', '2031-03-01', 'Shop rent', 'Rent', 100, 'Cash', 'Fuel Depot', 'posted', null]); expect(csv[2].slice(-2)).toEqual(['voided', 'oops'])
    const rep = reportExport({ total: 1500, count: 3, byCategory: [{ category: 'rent', total: 1000, count: 1 }, { category: 'fuel_energy', total: 500, count: 2 }], byMonth: [{ month: '2031-03', total: 1500 }], byMethod: [{ method: 'cash', total: 1500 }], bySupplier: [{ supplier: 'Fuel Depot', total: 500 }] })
    expect(rep[1]).toEqual(['Rent', 1000, 1, 66.7]); expect(rep.some((r) => r[0] === 'Fuel Depot')).toBe(true)
  })
})

describe('the sidebar for the Expenses app', () => {
  it('lists its parts', () => {
    const e = sidebarEntries(buildApps('general', new Set(['dashboard', 'expenses']))).filter((x) => x.kind === 'section' && x.module.code === 'expenses')
    expect(e.map((x) => (x.kind === 'section' ? x.section.key : ''))).toEqual(['expenses', 'budgets', 'report'])
  })
})
