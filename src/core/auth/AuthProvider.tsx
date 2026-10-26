import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { demoSignOut, useDemoState } from '@/demo/demoStore'
import { isDemoMode } from '@/shared/utilities/env'
import { supabase } from '@/shared/utilities/supabase'
import { Spinner } from '@/shared/components'

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
    supabase.auth.getSession().then(({ data }) => apply(data.session))
    const { data } = supabase.auth.onAuthStateChange((_e, session) => apply(session))
    return () => data.subscription.unsubscribe()
  }, [])

  const value: AuthState = isDemoMode
    ? {
        userId: demo.userId,
        email: demo.users.find((u) => u.id === demo.userId)?.email ?? null,
        loading: false,
        mustChange: demo.users.find((u) => u.id === demo.userId)?.mustChange === true,
        signOut: demoSignOut,
      }
    : { ...real, signOut: () => void supabase?.auth.signOut() }

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
