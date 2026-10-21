import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { IndustryCode, RoleName } from '@/shared/types/domain'
import { demoRoleIn, useDemoState } from '@/demo/demoStore'
import { isDemoMode } from '@/shared/utilities/env'
import { useAuth } from '@/core/auth/AuthProvider'
import { supabase } from '@/shared/utilities/supabase'

export interface BusinessSummary {
  id: string
  name: string
  industry: IndustryCode
  role?: RoleName | null
}

interface BusinessState {
  businesses: BusinessSummary[]
  active: BusinessSummary | null
  loading: boolean
  error: string | null
  select: (id: string) => void
  refresh: () => Promise<void>
}

const BusinessContext = createContext<BusinessState | null>(null)
const STORAGE_KEY = 'doa.activeBusiness'

function readStored(): string | null {
  try { return localStorage.getItem(STORAGE_KEY) } catch { return null }
}

/**
 * Lists only businesses RLS lets the user read. The stored id is a convenience:
 * it is ignored unless it appears in that authorised list.
 */
export function BusinessProvider({ children }: { children: ReactNode }) {
  const { userId } = useAuth()
  const demo = useDemoState()
  const [fetched, setBusinesses] = useState<BusinessSummary[]>([])
  const [activeId, setActiveId] = useState<string | null>(readStored)
  const [fetchLoading, setLoading] = useState(!!userId && !isDemoMode)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (isDemoMode || !supabase || !userId) {
      setBusinesses([])
      setLoading(false)
      return
    }
    setLoading(true)
    // Pick up any invitations addressed to this (confirmed) email before listing businesses.
    await supabase.rpc('accept_my_invitations')
    const { data, error } = await supabase
      .from('businesses')
      .select('id, name, primary_industry_code')
      .order('created_at')
    if (error) setError(error.message)
    else {
      setError(null)
      setBusinesses(data.map((b) => ({ id: b.id, name: b.name, industry: b.primary_industry_code as IndustryCode })))
    }
    setLoading(false)
  }, [userId])

  useEffect(() => {
    // Clear previous user's businesses immediately, then re-fetch the authorised list.
    setBusinesses([])
    void refresh()
  }, [refresh])

  const businesses: BusinessSummary[] = isDemoMode
    ? demo.members
        .filter((m) => m.userId === userId && m.status === 'active')
        .flatMap((m) => demo.businesses.filter((b) => b.id === m.businessId).map((b) => ({ ...b, role: demoRoleIn(b.id) })))
    : fetched
  const loading = isDemoMode ? false : fetchLoading
  const active = businesses.find((b) => b.id === activeId) ?? businesses[0] ?? null

  const select = (id: string) => {
    setActiveId(id)
    try { localStorage.setItem(STORAGE_KEY, id) } catch { /* storage unavailable */ }
  }

  return (
    <BusinessContext.Provider value={{ businesses, active, loading, error, select, refresh }}>
      {children}
    </BusinessContext.Provider>
  )
}

export function useBusiness() {
  const ctx = useContext(BusinessContext)
  if (!ctx) throw new Error('useBusiness must be used inside BusinessProvider')
  return ctx
}
