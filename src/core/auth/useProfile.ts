import { useAsync } from '@/shared/hooks/useAsync'
import { useDemoState } from '@/demo/demoStore'
import { isDemoMode } from '@/shared/utilities/env'
import { supabase } from '@/shared/utilities/supabase'
import { useAuth } from './AuthProvider'

/** The signed-in person's own details, for the top bar and the profile page. */
export function useProfile() {
  const { userId, email } = useAuth()
  const demo = useDemoState()
  const live = useAsync(async () => {
    if (isDemoMode || !userId || !supabase) return null
    const { data } = await supabase.from('profiles').select('display_name, phone').eq('id', userId).maybeSingle()
    return (data as { display_name: string | null; phone: string | null } | null) ?? null
  }, [userId])
  const name = (isDemoMode ? demo.users.find((u) => u.id === userId)?.name : live.data?.display_name) || email?.split('@')[0] || 'Account'
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || 'A'
  return { name, email, phone: live.data?.phone ?? '', initials, loading: live.loading, refresh: live.refresh }
}
