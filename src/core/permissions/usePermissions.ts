import { demoRoleIn } from '@/demo/demoStore'
import { useAsync } from '@/shared/hooks/useAsync'
import { isDemoMode } from '@/shared/utilities/env'
import { supabase } from '@/shared/utilities/supabase'
import { rolePermissions } from './roles'

/** Permission codes the signed-in user holds in a business. For showing or hiding actions only; the database enforces them. */
export async function myPermissions(businessId: string): Promise<string[]> {
  if (isDemoMode) {
    const role = demoRoleIn(businessId)
    return role ? [...rolePermissions(role)] : []
  }
  const { data } = await supabase!.rpc('my_permissions', { p_business: businessId })
  return (data as string[] | null) ?? []
}

export function usePermissions(businessId: string) {
  const perms = useAsync(() => (businessId ? myPermissions(businessId) : Promise.resolve([] as string[])), [businessId])
  return { loading: perms.loading, can: (code: string) => perms.data?.includes(code) ?? false }
}
