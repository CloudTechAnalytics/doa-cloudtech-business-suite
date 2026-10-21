import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { ModuleCode } from '@/shared/types/domain'
import { useBusiness } from '@/core/business-context/BusinessProvider'
import { demoModuleStatuses, useDemoState } from '@/demo/demoStore'
import { isDemoMode } from '@/shared/utilities/env'
import { supabase } from '@/shared/utilities/supabase'
import { availabilityOf } from '@/core/module-registry/availability'
import type { ModuleStatus } from '@/core/module-registry/availability'

interface ModulesState {
  statuses: ModuleStatus[]
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
}

const ModulesContext = createContext<ModulesState | null>(null)

interface Row {
  module_code: ModuleCode
  is_core: boolean
  is_required: boolean
  enabled: boolean
  entitled: boolean
  permitted: boolean
  usable: boolean
}

/**
 * Module availability for the active business. The UI uses it for navigation and route guards only;
 * the database enforces the same rules (module_usable / has_module_permission) independently.
 */
export function ModulesProvider({ children }: { children: ReactNode }) {
  const { active } = useBusiness()
  const demo = useDemoState()
  const businessId = active?.id ?? null
  const [live, setLive] = useState<{ forBusiness: string; statuses: ModuleStatus[] } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (isDemoMode || !supabase || !businessId) return
    const { data, error } = await supabase.rpc('my_modules', { p_business: businessId })
    if (error) return setError(error.message)
    setError(null)
    setLive({
      forBusiness: businessId,
      statuses: (data as Row[]).map((r) => ({
        code: r.module_code,
        isCore: r.is_core,
        isRequired: r.is_required,
        enabled: r.enabled,
        entitled: r.entitled,
        permitted: r.permitted,
        usable: r.usable,
        availability: availabilityOf(r),
      })),
    })
  }, [businessId])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh()
  }, [refresh, active?.industry])

  const value = useMemo<ModulesState>(() => {
    if (isDemoMode) {
      return { statuses: businessId ? demoModuleStatuses(businessId) : [], loading: false, error: null, refresh }
    }
    // Never show a previous business's modules while the new one loads.
    const fresh = live && live.forBusiness === businessId
    return { statuses: fresh ? live.statuses : [], loading: !fresh && !error && !!businessId, error, refresh }
    // demo is a dependency so demo statuses recompute on store changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId, live, error, refresh, demo])

  return <ModulesContext.Provider value={value}>{children}</ModulesContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useModules() {
  const ctx = useContext(ModulesContext)
  if (!ctx) throw new Error('useModules must be used inside ModulesProvider')
  return ctx
}
