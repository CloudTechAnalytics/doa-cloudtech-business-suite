import { demoArchiveBusiness } from '@/demo/demoStore'
import { isDemoMode } from '@/shared/utilities/env'
import { supabase } from '@/shared/utilities/supabase'

/** Deletes a business the owner no longer wants (archives it; records are kept). Returns an error message or null. */
export async function archiveBusiness(businessId: string, confirmName: string): Promise<string | null> {
  if (isDemoMode) return demoArchiveBusiness(businessId, confirmName)
  const { error } = await supabase!.rpc('archive_business', { p_business: businessId, p_confirm_name: confirmName })
  return error?.message ?? null
}
