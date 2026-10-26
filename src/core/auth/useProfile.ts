import { useEffect, useState } from 'react'
import { useAsync } from '@/shared/hooks/useAsync'
import { useDemoState } from '@/demo/demoStore'
import { env, isDemoMode } from '@/shared/utilities/env'
import { supabase } from '@/shared/utilities/supabase'
import { useAuth } from './AuthProvider'

const demoKey = (userId: string) => `doa.demo.avatar.${userId}`
const CHANGED = 'doa-avatar-changed'
/** Tells every part of the page showing the picture (the top bar, the profile page) to look again. */
export const announceAvatarChange = () => window.dispatchEvent(new Event(CHANGED))

/** Demo mode keeps the picture in this browser (as a small data string). */
export function setDemoAvatar(userId: string, dataUrl: string | null) {
  try { if (dataUrl) localStorage.setItem(demoKey(userId), dataUrl); else localStorage.removeItem(demoKey(userId)) } catch { /* storage unavailable */ }
  announceAvatarChange()
}
const readDemoAvatar = (userId: string | null) => { try { return userId ? localStorage.getItem(demoKey(userId)) : null } catch { return null } }

/** Where a stored picture can be looked at. Pictures live in the public "avatars" bucket, in a folder named after the person. */
export const avatarUrl = (path: string | null | undefined) => (path ? `${env.supabaseUrl}/storage/v1/object/public/avatars/${path}` : null)

/** The signed-in person's own details, for the top bar and the profile page. */
export function useProfile() {
  const { userId, email } = useAuth()
  const demo = useDemoState()
  const [, tick] = useState(0)
  const live = useAsync(async () => {
    if (isDemoMode || !userId || !supabase) return null
    const { data } = await supabase.from('profiles').select('display_name, phone, avatar_path').eq('id', userId).maybeSingle()
    return (data as { display_name: string | null; phone: string | null; avatar_path: string | null } | null) ?? null
  }, [userId])
  useEffect(() => {
    const sync = () => { tick((n) => n + 1); void live.refresh() }
    window.addEventListener(CHANGED, sync)
    return () => window.removeEventListener(CHANGED, sync)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId])
  const demoPic = isDemoMode ? readDemoAvatar(userId) : null
  const name = (isDemoMode ? demo.users.find((u) => u.id === userId)?.name : live.data?.display_name) || email?.split('@')[0] || 'Account'
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || 'A'
  const picturePath = live.data?.avatar_path ?? null
  return { userId, name, email, phone: live.data?.phone ?? '', initials, picture: isDemoMode ? demoPic : avatarUrl(picturePath), picturePath, loading: live.loading, refresh: live.refresh }
}
