import { CORE_MODULES } from '@/core/module-registry/core-modules'
import type { ModuleCode, PlanCode } from '@/shared/types/domain'

/**
 * Plan catalogue. The database is the source of truth (migrations seed the same data);
 * this copy drives demo mode and is checked against the SQL seed by tests.
 * Prices are a commercial decision and are deliberately not defined here.
 */
export const PLANS: Record<PlanCode, { name: string; excluded: ModuleCode[]; limits: { maxMembers: number; maxBranches: number } }> = {
  starter: { name: 'Starter', excluded: ['purchases', 'suppliers', 'farm-expenses'], limits: { maxMembers: 3, maxBranches: 1 } },
  basic: { name: 'Basic', excluded: [], limits: { maxMembers: 5, maxBranches: 1 } },
  growth: { name: 'Growth', excluded: [], limits: { maxMembers: 15, maxBranches: 3 } },
  business: { name: 'Business', excluded: [], limits: { maxMembers: 50, maxBranches: 10 } },
}

/** Monthly prices in naira. These match the plans seeded in the database (checked by tests/integration/pricing.test.ts). */
export const PLAN_PRICES: Record<PlanCode, number> = { starter: 0, basic: 5000, growth: 15000, business: 40000 }

export const planIncludes = (plan: PlanCode, module: ModuleCode) =>
  CORE_MODULES.includes(module) || !PLANS[plan].excluded.includes(module)
