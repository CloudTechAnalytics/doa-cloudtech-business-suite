import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { needsRelist } from './relist'
import { receiptOf } from './receiptDetails'
import type { ReceiptDetails } from './receiptDetails'
import { taxRateOf } from './taxRate'
import type { ReactNode } from 'react'
import type { IndustryCode, RoleName } from '@/shared/types/domain'
import { demoBlockedMemberships, demoRoleIn, useDemoState } from '@/demo/demoStore'
import { isDemoMode } from '@/shared/utilities/env'
import { useAuth } from '@/core/auth/AuthProvider'
import { supabase } from '@/shared/utilities/supabase'

export interface BusinessSummary {
  id: string
  name: string
  industry: IndustryCode
  role?: RoleName | null
  /** Only the owner may delete (archive) a business. */
  isOwner?: boolean
  /** The colour theme the owner chose for this business (a key from src/core/theme/themes.ts), if any. */
  theme?: string | null
  /** The sales tax the owner set (percent). The till uses it to show the same total the server will charge. */
  taxRate?: number
  /** The address, phone and closing line printed on receipts. */
  receipt?: ReceiptDetails
}

/** A business the person belongs to but may not use right now: their access was suspended or removed by the owner. */
export interface BlockedAccess { id: string; name: string; status: 'suspended' | 'revoked' }

interface BusinessState {
  businesses: BusinessSummary[]
  blocked: BlockedAccess[]
  active: BusinessSummary | null
  loading: boolean
  error: string | null
  select: (id: string) => void
  refresh: () => Promise<void>
  /** Reads the businesses again without showing the page as loading, so a settings card can show "Saved" instead of being reloaded away. */
  reload: () => Promise<void>
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
  // Which user the current list belongs to; until it matches, we are still loading (covers sign-up followed by an immediate redirect).
  const [loadedFor, setLoadedFor] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [fetchedBlocked, setBlocked] = useState<BlockedAccess[]>([])

  const load = useCallback(async (quiet: boolean) => {
    if (isDemoMode || !supabase || !userId) {
      setBusinesses([])
      setLoading(false)
      setLoadedFor(null)
      return
    }
    if (!quiet) setLoading(true)
    // Pick up any invitations addressed to this (confirmed) email, and list the businesses and blocked access, all at once: each round trip is slow on a
    // mobile connection. If an invitation was accepted the lists are asked for again so the new business is in them.
    const list = () => Promise.all([
      supabase!.from('businesses').select('id, name, primary_industry_code, owner_user_id, settings').order('created_at'),
      supabase!.rpc('my_blocked_memberships'),
    ])
    const [accepted, first] = await Promise.all([supabase.rpc('accept_my_invitations'), list()])
    const [{ data, error }, blockedRows] = needsRelist(accepted) ? await list() : first
    if (!blockedRows.error) setBlocked(((blockedRows.data ?? []) as { business_id: string; business_name: string; status: string }[]).map((r) => ({ id: r.business_id, name: r.business_name, status: r.status as BlockedAccess['status'] })))
    if (error) setError(error.message)
    else {
      setError(null)
      setBusinesses(data.map((b) => ({ id: b.id, name: b.name, industry: b.primary_industry_code as IndustryCode, isOwner: b.owner_user_id === userId, theme: (b.settings as { theme?: string } | null)?.theme ?? null, taxRate: taxRateOf(b.settings as { tax_rate_percent?: unknown } | null), receipt: receiptOf(b.settings as { receipt?: unknown } | null) })))
    }
    setLoading(false)
    setLoadedFor(userId)
  }, [userId])
  const refresh = useCallback(() => load(false), [load])
  const reload = useCallback(() => load(true), [load])

  useEffect(() => {
    // Clear previous user's businesses immediately, then re-fetch the authorised list.
    setBusinesses([]); setBlocked([])
    void load(false)
  }, [load])

  // Access can be withdrawn while someone is signed in, so look again every minute and whenever they come back to the tab. Quietly: no spinner, no reload.
  useEffect(() => {
    if (isDemoMode || !userId) return
    const again = () => { if (document.visibilityState === 'visible') void load(true) }
    const timer = setInterval(again, 60_000)
    document.addEventListener('visibilitychange', again)
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', again) }
  }, [load, userId])

  const businesses: BusinessSummary[] = isDemoMode
    ? demo.members
        .filter((m) => m.userId === userId && m.status === 'active')
        .flatMap((m) => demo.businesses.filter((b) => b.id === m.businessId && !b.archived && !b.suspended).map((b) => ({ ...b, role: demoRoleIn(b.id), isOwner: demoRoleIn(b.id) === 'owner', theme: b.settings?.theme ?? null, taxRate: taxRateOf(b.settings), receipt: receiptOf(b.settings) })))
    : fetched
  const blocked: BlockedAccess[] = isDemoMode ? demoBlockedMemberships() : fetchedBlocked
  const loading = isDemoMode ? false : fetchLoading || (!!userId && loadedFor !== userId)
  const active = businesses.find((b) => b.id === activeId) ?? businesses[0] ?? null

  const select = (id: string) => {
    setActiveId(id)
    try { localStorage.setItem(STORAGE_KEY, id) } catch { /* storage unavailable */ }
  }

  return (
    <BusinessContext.Provider value={{ businesses, blocked, active, loading, error, select, refresh, reload }}>
      {children}
    </BusinessContext.Provider>
  )
}

export function useBusiness() {
  const ctx = useContext(BusinessContext)
  if (!ctx) throw new Error('useBusiness must be used inside BusinessProvider')
  return ctx
}
