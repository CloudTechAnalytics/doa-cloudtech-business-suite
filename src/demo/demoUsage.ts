import type { PlanCode } from '@/shared/types/domain'

/**
 * Browser-only usage limits for demo mode. Mirrors supabase/migrations/20261021000049_usage_limits.sql: a limit is data on the plan, none is set by default, and it
 * stops new records only. Each store registers how it counts its own records, so this module stays free of the others (they import it, never the reverse).
 */
export const USAGE_KEYS = ['customers', 'invoices_per_month', 'sales_per_month', 'expenses_per_month'] as const
export type UsageKey = (typeof USAGE_KEYS)[number]
export interface UsageRow { key: UsageKey; used: number; limit: number | null }

const NOUN: Record<UsageKey, string> = { customers: 'customers', invoices_per_month: 'invoices a month', sales_per_month: 'sales a month', expenses_per_month: 'expenses a month' }

const limits: Partial<Record<PlanCode, Partial<Record<UsageKey, number>>>> = {}
/** Sets (or, with an empty object, clears) a plan's limits. Like the database, no plan has any until they are set. */
export const setDemoPlanLimits = (plan: PlanCode, l: Partial<Record<UsageKey, number>>) => { if (Object.keys(l).length) limits[plan] = l; else delete limits[plan] }

const counters: Partial<Record<UsageKey, (biz: string) => number>> = {}
export const registerUsageCounter = (key: UsageKey, fn: (biz: string) => number) => { counters[key] = fn }
let planOf: (biz: string) => PlanCode | null = () => null
export const registerPlanOf = (fn: (biz: string) => PlanCode | null) => { planOf = fn }

/** The first moment of this month, as an ISO date (the database counts months in UTC). */
export const monthStart = () => `${new Date().toISOString().slice(0, 7)}-01`

export const usageLimit = (biz: string, key: UsageKey): number | null => { const p = planOf(biz); return (p && limits[p]?.[key]) ?? null }
export const usageOf = (biz: string, key: UsageKey) => counters[key]?.(biz) ?? 0

/** The error a new record gets when its limit is used up; null when there is room (or no limit). */
export function demoUsageCheck(biz: string, key: UsageKey): string | null {
  const limit = usageLimit(biz, key)
  return limit !== null && usageOf(biz, key) >= limit ? `plan limit reached: your plan allows ${limit} ${NOUN[key]}. Upgrade the plan to add more; everything you already have is kept.` : null
}

export const demoUsage = (biz: string): UsageRow[] => USAGE_KEYS.map((key) => ({ key, used: usageOf(biz, key), limit: usageLimit(biz, key) }))
