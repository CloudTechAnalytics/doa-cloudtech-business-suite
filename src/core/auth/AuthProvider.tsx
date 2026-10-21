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
  signOut: () => void
}

const AuthContext = createContext<AuthState>({ userId: null, email: null, loading: true, signOut: () => {} })

export function AuthProvider({ children }: { children: ReactNode }) {
  const demo = useDemoState()
  const [real, setReal] = useState<{ userId: string | null; email: string | null; loading: boolean }>({
    userId: null, email: null, loading: !!supabase,
  })

  useEffect(() => {
    if (!supabase) return
    const apply = (s: { user: { id: string; email?: string } } | null) =>
      setReal({ userId: s?.user.id ?? null, email: s?.user.email ?? null, loading: false })
    supabase.auth.getSession().then(({ data }) => apply(data.session))
    const { data } = supabase.auth.onAuthStateChange((_e, session) => apply(session))
    return () => data.subscription.unsubscribe()
  }, [])

  const value: AuthState = isDemoMode
    ? {
        userId: demo.userId,
        email: demo.users.find((u) => u.id === demo.userId)?.email ?? null,
        loading: false,
        signOut: demoSignOut,
      }
    : { ...real, signOut: () => void supabase?.auth.signOut() }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => useContext(AuthContext)

export function RequireAuth({ children }: { children: ReactNode }) {
  const { userId, loading } = useAuth()
  const location = useLocation()
  if (loading) return <Spinner />
  if (!userId) return <Navigate to="/sign-in" state={{ from: location.pathname }} replace />
  return children
}
