import * as demo from '@/demo/demoFarm'
import type { FHealth } from '@/demo/demoFarm'
import * as ops from '@/demo/demoFarmOps'
import type { AlertRow, AssetInput, AssetRow, DMaintenance, DWorker, TaskInput, TaskStatus } from '@/demo/demoFarmOps'
import { getFinance } from '@/demo/demoFinance'
import { isDemoMode } from '@/shared/utilities/env'
import { supabase } from '@/shared/utilities/supabase'

/** Workers, tasks, health, equipment, crop costs and alerts. Live mode reads row-level-secured tables and views and calls
 *  database functions; demo mode runs the browser mirror. Mutations return an error message or null. */
export type { AlertRow, AssetInput, AssetRow, DMaintenance as MaintenanceDto, TaskInput, TaskStatus }
export { ASSET_TYPES } from '@/demo/demoFarmOps'

export interface WorkerDto { id: string; name: string; phone: string | null; role: string | null; active: boolean }
export interface TaskDto { id: string; title: string; description: string | null; due: string | null; priority: 'low' | 'normal' | 'high'; status: TaskStatus; assigneeId: string | null; batchId: string | null; requiresReview: boolean; completedAt: string | null }
export interface HealthDto { id: string; batchId: string; type: FHealth['type']; title: string; productId: string | null; quantity: number | null; on: string; withdrawalDays: number; withdrawalEndsOn: string | null; notes: string | null; status: 'posted' | 'voided'; voidReason: string | null }

const n = (v: unknown) => Number(v ?? 0)
const msg = (e: { message: string } | null) => e?.message ?? null
const db = () => supabase!
const dateOnly = (v: unknown) => (v ? String(v).slice(0, 10) : null)

// ------------------------------------------------------------------ workers
export async function listWorkers(b: string): Promise<WorkerDto[]> {
  if (isDemoMode) return ops.demoWorkers(b).map((w: DWorker) => ({ id: w.id, name: w.name, phone: w.phone, role: w.role, active: w.active }))
  const r = await db().from('farm_workers').select('*').eq('business_id', b).order('name')
  if (r.error) throw new Error(r.error.message)
  return (r.data ?? []).map((w) => ({ id: w.id, name: w.name, phone: w.phone, role: w.role_title, active: w.status === 'active' }))
}

/** Names only, so field staff can see who a task is assigned to. */
export async function listWorkerNames(b: string): Promise<{ id: string; name: string; active: boolean }[]> {
  if (isDemoMode) return ops.demoWorkers(b).map((w) => ({ id: w.id, name: w.name, active: w.active }))
  const r = await db().from('farm_worker_names').select('id, name, status').eq('business_id', b).order('name')
  if (r.error) return []
  return (r.data ?? []).map((w) => ({ id: w.id!, name: w.name!, active: w.status === 'active' }))
}

export async function saveWorker(b: string, v: { id: string | null; name: string; phone: string; role: string; active: boolean }) {
  if (isDemoMode) return ops.demoSaveWorker(b, v)
  return msg((await db().rpc('save_farm_worker', { p_business: b, p_id: v.id, p_name: v.name, p_phone: v.phone || null, p_role_title: v.role || null, p_active: v.active })).error)
}

// -------------------------------------------------------------------- tasks
export async function listTasks(b: string): Promise<TaskDto[]> {
  if (isDemoMode) return ops.getOps().tasks.filter((t) => t.businessId === b).map((t) => ({ id: t.id, title: t.title, description: t.description, due: t.due, priority: t.priority, status: t.status, assigneeId: t.assigneeId, batchId: t.batchId, requiresReview: t.requiresReview, completedAt: t.completedAt }))
  const r = await db().from('farm_tasks').select('*').eq('business_id', b).order('due_date', { nullsFirst: false }).limit(500)
  if (r.error) throw new Error(r.error.message)
  return (r.data ?? []).map((t) => ({ id: t.id, title: t.title, description: t.description, due: dateOnly(t.due_date), priority: t.priority as TaskDto['priority'], status: t.status as TaskStatus, assigneeId: t.assignee_worker_id, batchId: t.farm_batch_id, requiresReview: t.requires_review, completedAt: t.completed_at }))
}

export async function saveTask(b: string, v: TaskInput, key: string) {
  if (isDemoMode) return ops.demoSaveTask(b, v, key).error
  return msg((await db().rpc('save_farm_task', { p_business: b, p_id: v.id, p_title: v.title, p_description: v.description || null, p_due: v.due, p_priority: v.priority, p_assignee: v.assigneeId, p_batch: v.batchId, p_requires_review: v.requiresReview, p_key: key })).error)
}

export async function setTaskStatus(b: string, id: string, status: TaskStatus) {
  if (isDemoMode) return ops.demoSetTaskStatus(b, id, status)
  return msg((await db().rpc('set_farm_task_status', { p_task: id, p_status: status })).error)
}

// ------------------------------------------------------------------- health
export async function listHealth(b: string): Promise<HealthDto[]> {
  if (isDemoMode) {
    demo.ensureDemoFarm(b)
    return demo.getFarm().health.filter((h) => h.businessId === b).map((h) => ({ id: h.id, batchId: h.batchId, type: h.type, title: h.title, productId: h.productId, quantity: h.quantity, on: h.on, withdrawalDays: h.withdrawalDays, withdrawalEndsOn: h.withdrawalEndsOn, notes: h.notes, status: h.status, voidReason: h.voidReason })).reverse()
  }
  const r = await db().from('farm_health_records').select('*').eq('business_id', b).order('performed_on', { ascending: false }).limit(300)
  if (r.error) throw new Error(r.error.message)
  return (r.data ?? []).map((h) => ({ id: h.id, batchId: h.farm_batch_id, type: h.record_type as HealthDto['type'], title: h.title, productId: h.product_id, quantity: h.quantity === null ? null : n(h.quantity), on: dateOnly(h.performed_on)!, withdrawalDays: h.withdrawal_days, withdrawalEndsOn: dateOnly(h.withdrawal_ends_on), notes: h.notes, status: h.status as 'posted' | 'voided', voidReason: h.void_reason }))
}

export async function recordHealth(b: string, v: demo.NewHealth, key: string) {
  if (isDemoMode) return demo.demoRecordHealth(b, v, key).error
  return msg((await db().rpc('farm_record_health', { p_batch: v.batchId, p_type: v.type, p_title: v.title, p_product: v.productId, p_location: v.productId ? v.locationId : null, p_qty: v.productId ? v.quantity : null, p_on: v.on, p_withdrawal_days: v.withdrawalDays, p_notes: v.notes || null, p_key: key })).error)
}

export async function voidHealth(b: string, id: string, reason: string, key: string) {
  if (isDemoMode) return demo.demoVoidHealth(b, id, reason, key)
  return msg((await db().rpc('farm_void_health', { p_record: id, p_reason: reason, p_key: key })).error)
}

// ---------------------------------------------------------------- equipment
export async function listAssets(b: string): Promise<AssetRow[]> {
  if (isDemoMode) return ops.demoAssetRows(b)
  const r = await db().from('farm_asset_status').select('*').eq('business_id', b).order('name')
  if (r.error) throw new Error(r.error.message)
  return (r.data ?? []).map((a) => ({ id: a.id!, businessId: b, name: a.name!, type: a.asset_type!, serial: a.serial_number, purchaseDate: dateOnly(a.purchase_date), purchaseCost: a.purchase_cost === null ? null : n(a.purchase_cost), status: a.status as AssetRow['status'], intervalDays: a.service_interval_days, notes: a.notes, lastServiceOn: dateOnly(a.last_service_on), totalCost: n(a.total_cost), nextServiceOn: dateOnly(a.next_service_on), serviceOverdue: !!a.service_overdue }))
}

export async function listMaintenance(b: string): Promise<DMaintenance[]> {
  if (isDemoMode) return ops.getOps().maintenance.filter((m) => m.businessId === b).slice().reverse()
  const r = await db().from('farm_maintenance_records').select('*').eq('business_id', b).order('performed_on', { ascending: false }).limit(300)
  if (r.error) throw new Error(r.error.message)
  return (r.data ?? []).map((m) => ({ id: m.id, businessId: b, assetId: m.asset_id, kind: m.kind as DMaintenance['kind'], on: dateOnly(m.performed_on)!, cost: n(m.cost), description: m.description, expenseId: m.expense_id, status: m.status as 'posted' | 'voided', voidReason: m.void_reason }))
}

export async function saveAsset(b: string, v: AssetInput, key: string) {
  if (isDemoMode) return ops.demoSaveAsset(b, v, key).error
  return msg((await db().rpc('save_farm_asset', { p_business: b, p_id: v.id, p_name: v.name, p_type: v.type, p_serial: v.serial || null, p_purchase_date: v.purchaseDate, p_cost: v.purchaseCost, p_status: v.status, p_interval: v.intervalDays, p_notes: v.notes || null, p_key: key })).error)
}

export async function recordMaintenance(b: string, v: { assetId: string; kind: DMaintenance['kind']; on: string; cost: number; description: string; method: string }, key: string) {
  if (isDemoMode) return ops.demoRecordMaintenance(b, v, key).error
  return msg((await db().rpc('record_maintenance', { p_asset: v.assetId, p_kind: v.kind, p_on: v.on, p_cost: v.cost, p_description: v.description, p_method: v.method, p_key: key })).error)
}

export async function voidMaintenance(b: string, id: string, reason: string, key: string) {
  if (isDemoMode) return ops.demoVoidMaintenance(b, id, reason, key)
  return msg((await db().rpc('void_maintenance', { p_record: id, p_reason: reason, p_key: key })).error)
}

// ----------------------------------------------------------- costs and alerts
/** Posted expenses charged to each batch. */
export async function listBatchCosts(b: string): Promise<Map<string, number>> {
  if (isDemoMode) {
    const m = new Map<string, number>()
    for (const e of getFinance().expenses.filter((x) => x.businessId === b && x.status === 'posted' && x.batchId)) m.set(e.batchId!, Math.round(((m.get(e.batchId!) ?? 0) + e.amount) * 100) / 100)
    return m
  }
  const r = await db().from('farm_batch_costs').select('farm_batch_id, expenses_total').eq('business_id', b)
  if (r.error) return new Map()
  return new Map((r.data ?? []).map((x) => [x.farm_batch_id!, n(x.expenses_total)]))
}

export async function listAlerts(b: string): Promise<AlertRow[]> {
  if (isDemoMode) { demo.ensureDemoFarm(b); return ops.demoAlerts(b) }
  const { data, error } = await db().rpc('farm_alerts', { p_business: b })
  if (error) throw new Error(error.message)
  return ((data ?? []) as { kind: string; severity: AlertRow['severity']; title: string; detail: string; ref_module: string; ref_id: string }[]).map((x) => ({ kind: x.kind, severity: x.severity, title: x.title, detail: x.detail, module: x.ref_module, refId: x.ref_id }))
}
