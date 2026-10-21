import { beforeAll, describe, expect, it } from 'vitest'
import * as farm from '@/demo/demoFarm'
import * as ops from '@/demo/demoFarmOps'
import { demoCashbook, demoVoidExpense, getFinance } from '@/demo/demoFinance'
import { getInv } from '@/demo/demoInventory'
import { demoInvite, demoSignIn, demoSignOut } from '@/demo/demoStore'

const B = 'b-farm'
let n = 0
const key = () => `dfo-${n++}-abcdefgh`
const iso = (offset: number) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10)
const today = iso(0)
const as = (email: string) => { demoSignOut(); demoSignIn(email, 'demo1234') }
const product = (name: string) => getInv().products.find((p) => p.businessId === B && p.name.startsWith(name))!
const onHand = (name: string) => Object.entries(getInv().balances).filter(([k]) => k.startsWith(`${B}|${product(name).id}|`)).reduce((a, [, v]) => a + v.qty, 0)
const batch = (code: string) => farm.getFarm().batches.find((b) => b.businessId === B && b.code === code)!
let loc: string

const task = (over: Partial<ops.TaskInput> = {}, k = key()) => ops.demoSaveTask(B, { id: null, title: 'Clean House A', description: '', due: null, priority: 'normal', assigneeId: null, batchId: null, requiresReview: false, ...over }, k)
const asset = (over: Partial<ops.AssetInput> = {}, k = key()) => ops.demoSaveAsset(B, { id: null, name: 'Tractor T1', type: 'tractor', serial: '', purchaseDate: iso(-200), purchaseCost: 5000000, status: 'active', intervalDays: 90, notes: '', ...over }, k)
const health = (over: Partial<farm.NewHealth> = {}, k = key()) => farm.demoRecordHealth(B, { batchId: batch('B-2026-04').id, type: 'treatment', title: 'Antibiotic course', productId: product('Newcastle Vaccine').id, locationId: loc, quantity: 2, on: today, withdrawalDays: 0, notes: '', ...over }, k)

beforeAll(() => {
  demoSignIn('owner@demo.test', 'demo1234')
  farm.ensureDemoFarm(B)
  expect(demoInvite(B, 'cashier@demo.test', 'operations_staff')).toBeNull()
  loc = getInv().locations.find((l) => l.businessId === B)!.id
})

describe('demo workers and tasks follow the database rules', () => {
  it('workers: managers manage, unique names, staff cannot', () => {
    expect(ops.demoSaveWorker(B, { id: null, name: 'Musa Bello', phone: '', role: 'Attendant', active: true })).toBeNull()
    expect(ops.demoSaveWorker(B, { id: null, name: 'musa bello', phone: '', role: '', active: true })).toMatch(/duplicate key/)
    expect(ops.demoSaveWorker(B, { id: null, name: '', phone: '', role: '', active: true })).toMatch(/name/)
    as('cashier@demo.test')
    expect(ops.demoSaveWorker(B, { id: null, name: 'Nope', phone: '', role: '', active: true })).toMatch(/permission denied/)
    as('owner@demo.test')
  })

  it('tasks: idempotent create, staff progress, review needs a manager, cancel is manager-only', () => {
    const w = ops.demoWorkers(B)[0].id
    const k = key()
    const a = task({ assigneeId: w }, k)
    expect(a.error).toBeNull()
    expect(task({ assigneeId: w }, k).result).toEqual(a.result)
    expect(ops.getOps().tasks.filter((t) => t.title === 'Clean House A')).toHaveLength(1)
    expect(task({ title: 'x' }).error).toMatch(/at least 2 characters/)
    const id = a.result!.taskId
    as('cashier@demo.test')
    expect(task({ title: 'Nope' }).error).toMatch(/permission denied/)
    expect(ops.demoSetTaskStatus(B, id, 'in_progress')).toBeNull()
    expect(ops.demoSetTaskStatus(B, id, 'done')).toBeNull()
    expect(ops.demoSetTaskStatus(B, id, 'todo')).toMatch(/only a manager can reopen/)
    as('owner@demo.test')
    expect(ops.demoSetTaskStatus(B, id, 'todo')).toBeNull()
    expect(ops.demoSetTaskStatus(B, id, 'todo')).toMatch(/already todo/)

    const r = task({ title: 'Vaccination round', requiresReview: true }).result!.taskId
    as('cashier@demo.test')
    expect(ops.demoSetTaskStatus(B, r, 'done')).toMatch(/needs review/)
    expect(ops.demoSetTaskStatus(B, r, 'review')).toBeNull()
    expect(ops.demoSetTaskStatus(B, r, 'done')).toMatch(/only a manager can approve/)
    expect(ops.demoSetTaskStatus(B, r, 'cancelled')).toMatch(/only a manager can cancel/)
    as('owner@demo.test')
    expect(ops.demoSetTaskStatus(B, r, 'in_progress')).toBeNull() // sent back
    as('cashier@demo.test'); expect(ops.demoSetTaskStatus(B, r, 'review')).toBeNull(); as('owner@demo.test')
    expect(ops.demoSetTaskStatus(B, r, 'done')).toBeNull()
    expect(ops.getOps().tasks.find((t) => t.id === r)).toMatchObject({ status: 'done', reviewedBy: 'u-owner' })
    expect(task({ id: r, title: 'Edit after done' }).error).toMatch(/finished task cannot be edited/)
    expect(task({ assigneeId: 'nobody' }).error).toMatch(/unknown or inactive worker/)
  })
})

describe('demo health and withdrawal periods', () => {
  it('takes medicine out of stock once and validates input', () => {
    as('cashier@demo.test')
    const before = onHand('Newcastle Vaccine')
    const k = key()
    const a = health({ quantity: 2 }, k)
    expect(a.error).toBeNull()
    expect(health({ quantity: 2 }, k).result).toEqual(a.result)
    expect(onHand('Newcastle Vaccine')).toBe(before - 2)
    expect(health({ type: 'inspection' }).error).toMatch(/only treatments and vaccinations/)
    expect(health({ quantity: 0 }).error).toMatch(/greater than zero/)
    expect(health({ on: iso(2) }).error).toMatch(/future/)
    expect(health({ withdrawalDays: 400 }).error).toMatch(/between 0 and 365/)
    expect(health({ productId: null, quantity: 3 }).error).toMatch(/choose the medicine/)
    expect(health({ quantity: 999999 }).error).toMatch(/insufficient stock/)
    as('owner@demo.test')
  })

  it('blocks harvests and removals during a withdrawal, then unblocks when voided', () => {
    as('cashier@demo.test')
    const id = health({ title: 'Newcastle booster', withdrawalDays: 7, quantity: 1 }).result!.recordId
    const layer = batch('B-2026-04').id
    const eggs = product('Table eggs').id
    expect(farm.demoRecordHarvest(B, layer, eggs, loc, 5, today, null, key())).toMatch(/under a treatment withdrawal/)
    expect(farm.demoRecordHarvest(B, layer, eggs, loc, 5, today, 10, key())).toMatch(/under a treatment withdrawal/)
    expect(farm.demoRecordMortality(B, layer, 2, 'disease', today, key())).toBeNull() // deaths are not sales
    expect(ops.demoAlerts(B).some((a) => a.kind === 'withdrawal_active')).toBe(true)
    expect(farm.demoVoidHealth(B, id, 'entered twice', key())).toMatch(/permission denied/)
    as('owner@demo.test')
    expect(farm.demoAdjustPopulation(B, layer, 'removal', 3, '', today, key())).toMatch(/under a treatment withdrawal/)
    expect(farm.demoAdjustPopulation(B, layer, 'cull', 1, 'sick bird', today, key())).toBeNull()
    const before = onHand('Newcastle Vaccine')
    expect(farm.demoVoidHealth(B, id, 'x', key())).toMatch(/reason is required/)
    expect(farm.demoVoidHealth(B, id, 'entered twice', key())).toBeNull()
    expect(onHand('Newcastle Vaccine')).toBe(before + 1)
    expect(farm.demoVoidHealth(B, id, 'again please', key())).toMatch(/already voided/)
    expect(farm.demoRecordHarvest(B, layer, eggs, loc, 5, today, null, key())).toBeNull()
  })

  it('does not block once a withdrawal has ended', () => {
    health({ title: 'Old treatment', withdrawalDays: 3, on: iso(-10), quantity: 1 })
    expect(farm.demoRecordHarvest(B, batch('B-2026-04').id, product('Table eggs').id, loc, 1, today, null, key())).toBeNull()
    expect(farm.demoWithdrawals(B)).toHaveLength(0)
  })
})

describe('demo equipment and maintenance', () => {
  it('manages equipment (unique names, managers only) and turns a cost into one expense', () => {
    const k = key()
    const a = asset({}, k)
    expect(a.error).toBeNull()
    expect(asset({}, k).result).toEqual(a.result)
    expect(asset({ name: 'tractor t1' }).error).toMatch(/duplicate key/)
    const id = a.result!.assetId
    expect(ops.demoAssetRows(B).find((x) => x.id === id)).toMatchObject({ serviceOverdue: true, lastServiceOn: null })
    as('cashier@demo.test')
    expect(asset({ name: 'Nope' }).error).toMatch(/permission denied/)
    as('owner@demo.test')

    const m = (cost: number, on = today, kind: ops.DMaintenance['kind'] = 'repair', k2 = key()) => ops.demoRecordMaintenance(B, { assetId: id, kind, on, cost, description: 'Oil change and filters', method: 'cash' }, k2)
    const k3 = key()
    const rec = m(15000, today, 'repair', k3)
    expect(rec.error).toBeNull()
    expect(m(15000, today, 'repair', k3).result).toEqual(rec.result)
    const exp = getFinance().expenses.filter((e) => e.businessId === B && e.source === 'maintenance')
    expect(exp).toHaveLength(1)
    expect(exp[0]).toMatchObject({ category: 'repairs', amount: 15000 })
    expect(demoVoidExpense(B, exp[0].id, 'trying to void directly', key())).toMatch(/another record/)
    expect(demoCashbook(B).filter((e) => e.kind === 'expense' && e.amount === 15000)).toHaveLength(1)
    expect(m(5, iso(3)).error).toMatch(/future/)
    expect(ops.demoVoidMaintenance(B, rec.result!.recordId, 'x', key())).toMatch(/reason is required/)
    expect(ops.demoVoidMaintenance(B, rec.result!.recordId, 'wrong pump', key())).toBeNull()
    expect(demoCashbook(B).some((e) => e.kind === 'expense' && e.amount === 15000)).toBe(false)
    expect(ops.demoVoidMaintenance(B, rec.result!.recordId, 'again please', key())).toMatch(/already voided/)

    expect(m(0, today, 'service').error).toBeNull()
    expect(ops.demoAssetRows(B).find((x) => x.id === id)).toMatchObject({ serviceOverdue: false, lastServiceOn: today })
    expect(asset({ id, status: 'retired' }).error).toBeNull()
    expect(m(0).error).toMatch(/retired/)
  })
})

describe('demo alerts', () => {
  it('computes low stock, overdue work, mortality and crop harvests due', () => {
    expect(farm.demoCreateUnit(B, { name: 'Field 1', unitType: 'field', productionType: 'crop', capacity: null })).toBeNull()
    const field = farm.getFarm().units.find((u) => u.businessId === B && u.name === 'Field 1')!.id
    expect(farm.demoStartBatch(B, { unitId: field, code: 'C-1', species: 'Maize', variety: '', productionType: 'crop', opening: 2, startDate: iso(-60), plannedEnd: iso(3), basis: 'exact' }, key()).error).toBeNull()
    expect(task({ title: 'Late job', due: iso(-2), priority: 'high' }).error).toBeNull()
    expect(farm.demoRecordMortality(B, batch('B-2026-04').id, 400, 'heat', today, key())).toBeNull()
    const a = ops.demoAlerts(B)
    expect(a.map((x) => x.kind)).toEqual(expect.arrayContaining(['low_stock', 'overdue_task', 'high_mortality', 'harvest_due']))
    expect(a.find((x) => x.kind === 'low_stock')!.title).toMatch(/Grower Mash/) // 350 on hand, reorder level 500
    expect(a.find((x) => x.kind === 'overdue_task')!.severity).toBe('critical')
    expect(a.find((x) => x.kind === 'harvest_due')!.title).toMatch(/C-1/)
  })

  it('needs farm.read', () => {
    expect(() => ops.demoAlerts('b-retail')).toThrow(/permission denied/) // Alerts is not a retail module
  })
})
