import type { IndustryCode, ModuleCode } from '@/shared/types/domain'
import {
  demoChangeIndustry, demoDisableModule, demoEnableModule, demoPreviewIndustryChange, demoSetPlan,
} from '@/demo/demoStore'
import { isDemoMode } from '@/shared/utilities/env'
import { supabase } from '@/shared/utilities/supabase'
import type { PlanCode } from '@/shared/types/domain'

/** One call surface for module/industry operations; the live path goes through database functions. */
export interface IndustryPlan { incompatible: ModuleCode[]; toEnable: ModuleCode[] }

const fail = (e: { message: string } | null) => e?.message ?? null

export async function enableModule(businessId: string, code: ModuleCode): Promise<string | null> {
  if (isDemoMode) return demoEnableModule(businessId, code)
  return fail((await supabase!.rpc('enable_module', { p_business: businessId, p_module: code })).error)
}

export async function disableModule(businessId: string, code: ModuleCode): Promise<string | null> {
  if (isDemoMode) return demoDisableModule(businessId, code)
  return fail((await supabase!.rpc('disable_module', { p_business: businessId, p_module: code })).error)
}

export async function previewIndustryChange(
  businessId: string, industry: IndustryCode,
): Promise<{ plan?: IndustryPlan; error?: string }> {
  if (isDemoMode) {
    try { return { plan: demoPreviewIndustryChange(businessId, industry) } } catch (e) { return { error: (e as Error).message } }
  }
  const { data, error } = await supabase!.rpc('preview_industry_change', { p_business: businessId, p_industry: industry })
  if (error) return { error: error.message }
  const d = data as { incompatible_modules: ModuleCode[]; modules_to_enable: ModuleCode[] }
  return { plan: { incompatible: d.incompatible_modules, toEnable: d.modules_to_enable } }
}

export async function changeIndustry(businessId: string, industry: IndustryCode, confirm: boolean): Promise<string | null> {
  if (isDemoMode) return demoChangeIndustry(businessId, industry, confirm)
  return fail((await supabase!.rpc('change_industry', { p_business: businessId, p_industry: industry, p_confirm: confirm })).error)
}

/** Demo only. In production plan changes arrive from verified payment-provider webhooks. */
export function demoSwitchPlan(businessId: string, plan: PlanCode | null): string | null {
  return demoSetPlan(businessId, plan)
}
