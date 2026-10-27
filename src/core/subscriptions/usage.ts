import '@/demo/demoFinance'
import '@/demo/demoInvoices'
import '@/demo/demoTrade'
import { demoUsage } from '@/demo/demoUsage'
import type { UsageKey, UsageRow } from '@/demo/demoUsage'
import { isDemoMode } from '@/shared/utilities/env'
import { supabase } from '@/shared/utilities/supabase'

export type { UsageKey, UsageRow }

/** How each limit reads on screen. The numbers themselves are plan data in the database; none is written here. */
export const USAGE_LABEL: Record<UsageKey, { name: string; noun: string }> = {
  customers: { name: 'Customers', noun: 'customers' },
  invoices_per_month: { name: 'Invoices this month', noun: 'invoices this month' },
  sales_per_month: { name: 'Sales this month', noun: 'sales this month' },
  expenses_per_month: { name: 'Expenses this month', noun: 'expenses this month' },
}

/** 'unlimited' when the plan has no limit, 'ok', 'near' from 80% of the limit, 'full' when no more can be added. */
export function usageLevel(r: Pick<UsageRow, 'used' | 'limit'>): 'unlimited' | 'ok' | 'near' | 'full' {
  if (r.limit === null) return 'unlimited'
  if (r.used >= r.limit) return 'full'
  return r.used >= r.limit * 0.8 ? 'near' : 'ok'
}

/** What the business has used against each limit of its plan. For showing only: the database enforces the limits. */
export async function loadUsage(businessId: string): Promise<UsageRow[]> {
  if (isDemoMode) return demoUsage(businessId)
  const { data, error } = await supabase!.rpc('my_usage', { p_business: businessId })
  if (error) throw new Error(error.message)
  return (data as { key: UsageKey; used: number; limit: number | null }[]).map((r) => ({ key: r.key, used: Number(r.used), limit: r.limit === null ? null : Number(r.limit) }))
}
