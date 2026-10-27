import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { demoSignOut, useDemoState } from '@/demo/demoStore'
import { isDemoMode } from '@/shared/utilities/env'
import { supabase } from '@/shared/utilities/supabase'
import { Spinner } from '@/shared/components'
import { markReturning, markSignedOut } from './returning'

interface AuthState {
  userId: string | null
  email: string | null
  loading: boolean
  /** True when the person signed in with a temporary password and has not yet chosen their own. */
  mustChange: boolean
  signOut: () => void
}

const AuthContext = createContext<AuthState>({ userId: null, email: null, loading: true, mustChange: false, signOut: () => {} })

export function AuthProvider({ children }: { children: ReactNode }) {
  const demo = useDemoState()
  const [real, setReal] = useState<{ userId: string | null; email: string | null; loading: boolean; mustChange: boolean }>({
    userId: null, email: null, loading: !!supabase, mustChange: false,
  })

  useEffect(() => {
    if (!supabase) return
    const apply = (s: { user: { id: string; email?: string; user_metadata?: Record<string, unknown> } } | null) =>
      setReal({ userId: s?.user.id ?? null, email: s?.user.email ?? null, loading: false, mustChange: s?.user.user_metadata?.must_change_password === true })
    supabase.auth.getSession().then(({ data }) => { apply(data.session); if (data.session) void verify() })
    const { data } = supabase.auth.onAuthStateChange((_e, session) => apply(session))
    // A saved session is only a browser's memory of a sign-in. If the account was deleted or the sign-in was revoked, the server says so here and this
    // browser forgets it, instead of carrying on as that person. A network failure is not an answer, so it is ignored.
    async function verify() {
      if (!supabase) return
      const { data: who, error } = await supabase.auth.getUser()
      const gone = !!error && (error.status === 401 || error.status === 403 || error.status === 404 || /user_not_found|session_not_found|bad_jwt|jwt/i.test(error.code ?? error.message ?? ''))
      if (gone || (!error && !who.user)) await supabase.auth.signOut({ scope: 'local' })
    }
    const again = () => { if (document.visibilityState === 'visible') void verify() }
    const timer = setInterval(again, 60_000)
    document.addEventListener('visibilitychange', again)
    return () => { data.subscription.unsubscribe(); clearInterval(timer); document.removeEventListener('visibilitychange', again) }
  }, [])

  const value: AuthState = isDemoMode
    ? {
        userId: demo.userId,
        email: demo.users.find((u) => u.id === demo.userId)?.email ?? null,
        loading: false,
        mustChange: demo.users.find((u) => u.id === demo.userId)?.mustChange === true,
        signOut: () => { markSignedOut(); demoSignOut() },
      }
    : { ...real, signOut: () => { markSignedOut(); void supabase?.auth.signOut() } }
  const signedInId = value.userId
  useEffect(() => { if (signedInId) markReturning() }, [signedInId])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => useContext(AuthContext)

export function RequireAuth({ children }: { children: ReactNode }) {
  const { userId, loading, mustChange } = useAuth()
  const location = useLocation()
  if (loading) return <Spinner />
  if (!userId) return <Navigate to="/sign-in" state={{ from: location.pathname }} replace />
  if (mustChange && location.pathname !== '/set-password') return <Navigate to="/set-password" replace />
  return children
}
