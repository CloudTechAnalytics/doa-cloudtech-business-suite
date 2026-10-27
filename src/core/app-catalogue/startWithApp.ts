import { getIndustry } from '@/core/industry-registry'
import { disableModule } from '@/core/module-registry/moduleActions'
import { demoSetStartedWithApp } from '@/demo/demoStore'
import { isDemoMode } from '@/shared/utilities/env'
import { supabase } from '@/shared/utilities/supabase'
import { STANDALONE_APPS } from './apps'

/**
 * A new Business apps workspace starts with every shared app on. When the person came from one app's link (POS, Invoices, ...), switch the others off so they
 * sign in to that app alone. Nothing is deleted and nothing is lost: the rest are one click away in the App Library. Returns an error message, or null.
 */
export async function startWithApp(businessId: string, appId: string): Promise<string | null> {
  const app = STANDALONE_APPS.find((a) => a.id === appId)
  if (!app) return null
  const keep = new Set<string>(app.modules)
  for (const code of getIndustry('general').defaultModules) {
    if (keep.has(code)) continue
    const err = await disableModule(businessId, code)
    if (err) return `could not start with only ${app.name} (${err})`
  }
  // Remember which app they came for, so the platform team can tell what the workspace began as.
  const recorded = isDemoMode ? demoSetStartedWithApp(businessId, appId) : (await supabase!.rpc('set_started_with_app', { p_business: businessId, p_app: appId })).error?.message ?? null
  return recorded ? `started, but could not record the starting app (${recorded})` : null
}
