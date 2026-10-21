import type { ReactNode } from 'react'
import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from '@/core/auth/AuthProvider'
import { BusinessProvider } from '@/core/business-context/BusinessProvider'
import { ModulesProvider } from '@/core/module-registry/ModulesProvider'

/** Provider order matters: auth, then the active business, then the modules available to it. */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <BrowserRouter>
      <AuthProvider>
        <BusinessProvider>
          <ModulesProvider>{children}</ModulesProvider>
        </BusinessProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}
