import { Suspense } from 'react'
import { Link, Navigate, Route, Routes } from 'react-router-dom'
import { PageFrame } from '@/app/layouts/PageFrame'
import { AppShell } from '@/app/layouts/AppShell'
import { SignInPage, SignUpPage } from '@/core/auth/AuthPages'
import { RequireAuth } from '@/core/auth/AuthProvider'
import { OnboardingPage } from '@/core/businesses/OnboardingPage'
import { ModuleRoute } from '@/core/module-registry/ModuleRoute'
import { buildModuleRoutes } from '@/core/module-registry/routes'
import { PlatformAdminPage } from '@/core/platform-admin/PlatformAdminPage'
import { EmptyState, Spinner } from '@/shared/components'

// Built once from the shared modules and the industry registry; adding an industry adds its routes here with no router edits.
const MODULE_ROUTES = buildModuleRoutes()

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/app/dashboard" replace />} />
      <Route path="/sign-in" element={<SignInPage />} />
      <Route path="/sign-up" element={<SignUpPage />} />
      <Route path="/onboarding" element={<RequireAuth><PageFrame><OnboardingPage /></PageFrame></RequireAuth>} />
      <Route path="/app" element={<RequireAuth><AppShell /></RequireAuth>}>
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route path="onboarding" element={<OnboardingPage />} />
        <Route path="platform-admin" element={<PlatformAdminPage />} />
        {MODULE_ROUTES.map(({ path, code, component: Page }) => (
          <Route key={code} path={path} element={<ModuleRoute code={code}><Suspense fallback={<Spinner />}><Page /></Suspense></ModuleRoute>} />
        ))}
        <Route path="*" element={<EmptyState title="Page not found" action={<Link className="underline" to="/app/dashboard">Go to dashboard</Link>} />} />
      </Route>
      <Route path="*" element={<Navigate to="/app" replace />} />
    </Routes>
  )
}
