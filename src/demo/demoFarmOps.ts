import { demoMaintenanceExpense, demoVoidMaintenanceExpense, PAY_METHODS } from '@/demo/demoFinance'
import { getFarm, demoWithdrawals } from '@/demo/demoFarm'
import { getInv, newId } from '@/demo/demoInventory'
import { demoBills } from '@/demo/demoOrders'
import { getDemoState } from '@/demo/demoStore'
import { demoAllowed } from '@/demo/demoTrade'

/**
 * Browser-only workers, tasks, equipment, maintenance and alerts for demo mode. Mirrors
 * supabase/migrations/20261021000012_farm_operations.sql (and the health part, which lives in demoFarm because it
 * shares the batch ledger).
 */
export interface DWorker { id: string; businessId: string; name: string; phone: string | null; role: string | null; active: boolean }
export type TaskStatus = 'todo' | 'in_progress' | 'review' | 'done' | 'cancelled'
export interface DTask {
  id: string; businessId: string; title: string; description: string | null; due: string | null; priority: 'low' | 'normal' | 'high'; status: TaskStatus
  assigneeId: string | null; batchId: string | null; requiresReview: boolean; completedAt: string | null; reviewedBy: string | null
}
export const ASSET_TYPES = ['tractor', 'pump', 'generator', 'vehicle', 'feeder', 'tool', 'other'] as const
export interface DAsset {
  id: string; businessId: string; name: string; type: string; serial: string | null; purchaseDate: string | null; purchaseCost: number | null
  status: 'active' | 'under_repair' | 'retired'; intervalDays: number | null; notes: string | null
}
export interface DMaintenance { id: string; businessId: string; assetId: string; kind: 'service' | 'repair' | 'inspection'; on: string; cost: number; description: string; expenseId: string | null; status: 'posted' | 'voided'; voidReason: string | null }
interface Ops { workers: DWorker[]; tasks: DTask[]; assets: DAsset[]; maintenance: DMaintenance[]; keys: Record<string, string> }

const KEY = 'doa.demo.farmops.v1'
const empty = (): Ops => ({ workers: [], tasks: [], assets: [], maintenance: [], keys: {} })
function load(): Ops {
  try { const raw = localStorage.getItem(KEY); if (raw) return { ...empty(), ...(JSON.parse(raw) as Ops) } } catch { /* fresh */ }
  return empty()
}
let state = load()
function commit(next: Ops) {
  state = next
  try { localStorage.setItem(KEY, JSON.stringify(state)) } catch { /* storage unavailable */ }
}
export const getOps = () => state
export const resetDemoFarmOps = () => commit(empty())

const today = () => new Date().toISOString().slice(0, 10)
const me = () => getDemoState().userId
const clone = (): Ops => JSON.parse(JSON.stringify(state)) as Ops
const guard = (biz: string, module: string, perm: string) => { if (!demoAllowed(biz, module, perm)) throw new Error('permission denied') }
type Out<R> = { error: string | null; result?: R }

/** Runs a write with the permission check first and idempotency by key (where the database function takes one). */
function run<R>(biz: string, op: string, key: string | null, module: string, perm: string, fn: (o: Ops) => R): Out<R> {
  try {
    guard(biz, module, perm)
    if (key !== null) {
      if (key.length < 8) throw new Error('an idempotency key of at least 8 characters is required')
      const prev = state.keys[`${biz}|${key}`]
      if (prev) {
        const i = prev.indexOf('|')
        if (prev.slice(0, i) !== op) throw new Error('idempotency key already used for another operation')
        return { error: null, result: JSON.parse(prev.slice(i + 1)) as R }
      }
    }
    const o = clone()
    const result = fn(o)
    if (key !== null) o.keys[`${biz}|${key}`] = `${op}|${JSON.stringify(result ?? null)}`
    commit(o)
    return { error: null, result }
  } catch (e) {
    return { error: (e as Error).message }
  }
}

// ------------------------------------------------------------------- workers
export function demoSaveWorker(biz: string, v: { id: string | null; name: string; phone: string; role: string; active: boolean }): string | null {
  return run(biz, 'worker', null, 'farm-workers', 'farm.manage', (o) => {
    if (!v.name.trim()) throw new Error("enter the worker's name")
    if (o.workers.some((w) => w.businessId === biz && w.id !== v.id && w.name.trim().toLowerCase() === v.name.trim().toLowerCase())) throw new Error('duplicate key: a worker with this name already exists')
    const fields = { name: v.name.trim(), phone: v.phone.trim() || null, role: v.role.trim() || null, active: v.active }
    if (v.id === null) o.workers.push({ id: newId('wk'), businessId: biz, ...fields })
    else {
      const w = o.workers.find((x) => x.id === v.id && x.businessId === biz)
      if (!w) throw new Error('worker not found')
      Object.assign(w, fields)
    }
    return null
  }).error
}

/** Everyone with farm.read sees names only (the worker_names view); managers see all details. */
export const demoWorkers = (biz: string) => state.workers.filter((w) => w.businessId === biz)

// --------------------------------------------------------------------- tasks
export interface TaskInput { id: string | null; title: string; description: string; due: string | null; priority: 'low' | 'normal' | 'high'; assigneeId: string | null; batchId: string | null; requiresReview: boolean }

export function demoSaveTask(biz: string, v: TaskInput, key: string) {
  return run(biz, 'task', v.id === null ? key : null, 'farm-tasks', 'farm.manage', (o) => {
    if (v.title.trim().length < 2) throw new Error('enter a task title (at least 2 characters)')
    if (v.assigneeId && !o.workers.some((w) => w.id === v.assigneeId && w.businessId === biz && w.active)) throw new Error('unknown or inactive worker')
    if (v.batchId && !getFarm().batches.some((b) => b.id === v.batchId && b.businessId === biz)) throw new Error('unknown batch')
    const fields = { title: v.title.trim(), description: v.description.trim() || null, due: v.due, priority: v.priority, assigneeId: v.assigneeId, batchId: v.batchId, requiresReview: v.requiresReview }
    if (v.id === null) {
      const t: DTask = { id: newId('tk'), businessId: biz, ...fields, status: 'todo', completedAt: null, reviewedBy: null }
      o.tasks.push(t)
      return { taskId: t.id }
    }
    const t = o.tasks.find((x) => x.id === v.id && x.businessId === biz)
    if (!t) throw new Error('task not found')
    if (t.status === 'done' || t.status === 'cancelled') throw new Error('a finished task cannot be edited; reopen it first')
    Object.assign(t, fields)
    return { taskId: t.id }
  })
}

/** Field staff move work forward; only a manager approves reviewed work, sends it back, cancels or reopens. */
export function demoSetTaskStatus(biz: string, id: string, status: TaskStatus): string | null {
  try {
    const t0 = state.tasks.find((x) => x.id === id && x.businessId === biz)
    if (!t0) throw new Error('task not found')
    const manage = demoAllowed(biz, 'farm-tasks', 'farm.manage'); const record = demoAllowed(biz, 'farm-tasks', 'farm.record')
    if (!manage && !record) throw new Error('permission denied')
    if (status === t0.status) throw new Error(`the task is already ${t0.status.replace('_', ' ')}`)
    const next: TaskStatus = t0.requiresReview ? 'review' : 'done'
    if (t0.status === 'done' || t0.status === 'cancelled') {
      if (!(manage && status === 'todo')) throw new Error('only a manager can reopen a finished task')
    } else if (status === 'cancelled') {
      if (!manage) throw new Error('only a manager can cancel a task')
    } else if (t0.status === 'review') {
      if (!(manage && (status === 'done' || status === 'in_progress'))) throw new Error('only a manager can approve or send back reviewed work')
    } else if (!(status === 'in_progress' || status === next)) {
      throw new Error(t0.requiresReview ? 'this task needs review: send it for review instead of marking it done' : 'invalid status change')
    }
    const o = clone()
    const t = o.tasks.find((x) => x.id === id)!
    t.reviewedBy = t0.status === 'review' && status === 'done' ? me() : null
    t.completedAt = status === 'done' ? new Date().toISOString() : null
    t.status = status
    commit(o)
    return null
  } catch (e) {
    return (e as Error).message
  }
}

// ----------------------------------------------------------------- equipment
export interface AssetInput { id: string | null; name: string; type: string; serial: string; purchaseDate: string | null; purchaseCost: number | null; status: DAsset['status']; intervalDays: number | null; notes: string }

export function demoSaveAsset(biz: string, v: AssetInput, key: string) {
  return run(biz, 'asset', v.id === null ? key : null, 'farm-equipment', 'farm.manage', (o) => {
    if (!v.name.trim()) throw new Error('enter the equipment name')
    if (v.purchaseCost !== null && v.purchaseCost < 0) throw new Error('cost cannot be negative')
    if (v.purchaseDate && v.purchaseDate > today()) throw new Error('the purchase date cannot be in the future')
    if (o.assets.some((a) => a.businessId === biz && a.id !== v.id && a.name.trim().toLowerCase() === v.name.trim().toLowerCase())) throw new Error('duplicate key: equipment with this name already exists')
    const fields = { name: v.name.trim(), type: v.type, serial: v.serial.trim() || null, purchaseDate: v.purchaseDate, purchaseCost: v.purchaseCost, status: v.status, intervalDays: v.intervalDays, notes: v.notes.trim() || null }
    if (v.id === null) {
      const a: DAsset = { id: newId('as'), businessId: biz, ...fields }
      o.assets.push(a)
      return { assetId: a.id }
    }
    const a = o.assets.find((x) => x.id === v.id && x.businessId === biz)
    if (!a) throw new Error('equipment not found')
    Object.assign(a, fields)
    return { assetId: a.id }
  })
}

export function demoRecordMaintenance(biz: string, v: { assetId: string; kind: DMaintenance['kind']; on: string; cost: number; description: string; method: string }, key: string) {
  return run(biz, 'maintenance', key, 'farm-equipment', 'farm.manage', (o) => {
    const a = o.assets.find((x) => x.id === v.assetId && x.businessId === biz)
    if (!a) throw new Error('equipment not found')
    if (a.status === 'retired') throw new Error('retired equipment cannot be serviced')
    if (!['service', 'repair', 'inspection'].includes(v.kind)) throw new Error('unknown maintenance type')
    if (!v.on || v.on > today()) throw new Error('the date cannot be in the future')
    if (!(v.cost >= 0) || Math.round(v.cost * 100) / 100 !== v.cost) throw new Error('cost must be zero or more with at most 2 decimals')
    if (v.description.trim().length < 2) throw new Error('describe the work (at least 2 characters)')
    if (v.cost > 0 && !(PAY_METHODS as readonly string[]).includes(v.method)) throw new Error('choose how it was paid')
    // The expense is created last: it commits straight away, so nothing after it may fail.
    const expenseId = v.cost > 0 ? demoMaintenanceExpense(biz, { amount: v.cost, method: v.method, description: `${a.name}: ${v.description.trim()}`, date: v.on }) : null
    const r: DMaintenance = { id: newId('mt'), businessId: biz, assetId: v.assetId, kind: v.kind, on: v.on, cost: v.cost, description: v.description.trim(), expenseId, status: 'posted', voidReason: null }
    o.maintenance.push(r)
    return { recordId: r.id }
  })
}

export function demoVoidMaintenance(biz: string, id: string, reason: string, key: string) {
  return run(biz, 'maintenance_void', key, 'farm-equipment', 'farm.manage', (o) => {
    const r = o.maintenance.find((x) => x.id === id && x.businessId === biz)
    if (!r) throw new Error('record not found')
    if (r.status !== 'posted') throw new Error('record is already voided')
    if (reason.trim().length < 3) throw new Error('a reason is required')
    r.status = 'voided'; r.voidReason = reason.trim()
    if (r.expenseId) demoVoidMaintenanceExpense(biz, r.expenseId, reason.trim())
    return { recordId: id }
  }).error
}

export interface AssetRow extends DAsset { lastServiceOn: string | null; totalCost: number; nextServiceOn: string | null; serviceOverdue: boolean }
export function demoAssetRows(biz: string): AssetRow[] {
  return state.assets.filter((a) => a.businessId === biz).map((a) => {
    const recs = state.maintenance.filter((m) => m.assetId === a.id && m.status === 'posted')
    const last = recs.filter((m) => m.kind === 'service').map((m) => m.on).sort().at(-1) ?? null
    const base = last ?? a.purchaseDate
    const next = a.intervalDays !== null && base ? new Date(Date.parse(base) + a.intervalDays * 86400000).toISOString().slice(0, 10) : null
    return { ...a, lastServiceOn: last, totalCost: Math.round(recs.reduce((s, m) => s + m.cost * 100, 0)) / 100, nextServiceOn: next, serviceOverdue: a.status !== 'retired' && next !== null && next < today() }
  })
}

// -------------------------------------------------------------------- alerts
export interface AlertRow { kind: string; severity: 'critical' | 'warning' | 'info'; title: string; detail: string; module: string; refId: string }

/** Same rules and thresholds as farm_alerts(): weekly mortality above 2%, harvest due within 7 days. */
export function demoAlerts(biz: string): AlertRow[] {
  guard(biz, 'farm-alerts', 'farm.read')
  const out: AlertRow[] = []
  const inv = getInv()
  const farm = getFarm()
  const day = (offset: number) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10)
  const fmt = (n: number) => String(Math.round(n * 10000) / 10000)

  for (const p of inv.products.filter((x) => x.businessId === biz && x.status === 'active' && x.reorderLevel !== null && x.reorderLevel > 0)) {
    const onHand = Object.entries(inv.balances).filter(([k]) => k.startsWith(`${biz}|${p.id}|`)).reduce((a, [, v]) => a + v.qty, 0)
    if (onHand <= (p.reorderLevel as number)) out.push({ kind: 'low_stock', severity: onHand <= 0 ? 'critical' : 'warning', title: `${p.name} is running low`, detail: `On hand ${fmt(onHand)}, reorder level ${fmt(p.reorderLevel as number)}`, module: 'inventory', refId: p.id })
  }
  for (const b of farm.batches.filter((x) => x.businessId === biz && x.status === 'active' && x.productionType !== 'crop')) {
    const ev = farm.events.filter((e) => e.batchId === b.id)
    const byId = new Map(ev.map((e) => [e.id, e]))
    const deaths = ev.filter((e) => e.on >= day(-7) && (e.type === 'mortality' || (e.reversesId && byId.get(e.reversesId)?.type === 'mortality'))).reduce((a, e) => a - e.quantity, 0)
    const population = ev.reduce((a, e) => a + e.quantity, 0)
    if (deaths > 0 && (deaths * 100) / (population + deaths) > 2) out.push({ kind: 'high_mortality', severity: 'critical', title: `High mortality in ${b.code}`, detail: `${fmt(deaths)} deaths in the last 7 days (${(Math.round((deaths * 1000) / (population + deaths)) / 10).toFixed(1)}% of the batch)`, module: 'farm-mortality', refId: b.id })
  }
  for (const t of state.tasks.filter((x) => x.businessId === biz && ['todo', 'in_progress', 'review'].includes(x.status) && x.due !== null && x.due < today())) {
    out.push({ kind: 'overdue_task', severity: t.priority === 'high' ? 'critical' : 'warning', title: `Overdue: ${t.title}`, detail: `Was due ${t.due}`, module: 'farm-tasks', refId: t.id })
  }
  for (const w of demoWithdrawals(biz)) {
    const b = farm.batches.find((x) => x.id === w.batchId)
    out.push({ kind: 'withdrawal_active', severity: 'info', title: `${b?.code} is under a treatment withdrawal`, detail: `${w.title} until ${w.withdrawalEndsOn}`, module: 'farm-health', refId: w.batchId })
  }
  for (const b of farm.batches.filter((x) => x.businessId === biz && x.status === 'active' && x.productionType === 'crop' && x.plannedEnd !== null && x.plannedEnd <= day(7))) {
    const late = (b.plannedEnd as string) < today()
    out.push({ kind: 'harvest_due', severity: late ? 'warning' : 'info', title: `${b.code} (${b.species}) harvest ${late ? 'is overdue' : 'is due soon'}`, detail: `Expected ${b.plannedEnd}`, module: 'farm-crops', refId: b.id })
  }
  for (const a of demoAssetRows(biz).filter((x) => x.serviceOverdue)) {
    out.push({ kind: 'service_due', severity: 'warning', title: `${a.name} needs servicing`, detail: `Was due ${a.nextServiceOn}`, module: 'farm-equipment', refId: a.id })
  }
  for (const b of demoBills(biz).filter((x) => x.overdue)) {
    out.push({ kind: 'overdue_bill', severity: 'warning', title: `Supplier bill ${b.number} is overdue`, detail: `${b.supplierName}, due ${b.dueDate}`, module: 'farm-supplier-bills', refId: b.id })
  }
  return out
}
