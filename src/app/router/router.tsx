import { Suspense } from 'react'
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AppShell } from '@/app/layouts/AppShell'
import { AppsHome } from '@/app/layouts/AppsHome'
import { LandingPage } from '@/app/landing/LandingPage'
import { SignInPage, SignUpPage } from '@/core/auth/AuthPages'
import { RequireAuth } from '@/core/auth/AuthProvider'
import { BusinessesPage } from '@/core/businesses/BusinessesPage'
import { OnboardingPage } from '@/core/businesses/OnboardingPage'
import { ModuleRoute } from '@/core/module-registry/ModuleRoute'
import { buildModuleRoutes } from '@/core/module-registry/routes'
import { PlatformAdminPage } from '@/core/platform-admin/PlatformAdminPage'
import { EmptyState, Spinner } from '@/shared/components'

// Built once from the shared modules and the industry registry; adding an industry adds its routes here with no router edits.
const MODULE_ROUTES = buildModuleRoutes()

/** Remounts the picker when the query changes, so a menu link such as /start?type=farm pre-selects that type. */
function StartPage() {
  const { search } = useLocation()
  return <OnboardingPage key={search} />
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/sign-in" element={<SignInPage />} />
      <Route path="/sign-up" element={<SignUpPage />} />
      <Route path="/start" element={<StartPage />} />
      <Route path="/onboarding" element={<StartPage />} />
      <Route path="/businesses" element={<RequireAuth><BusinessesPage /></RequireAuth>} />
      <Route path="/app" element={<RequireAuth><AppShell /></RequireAuth>}>
        <Route index element={<AppsHome />} />
        <Route path="platform-admin" element={<PlatformAdminPage />} />
        {MODULE_ROUTES.map(({ path, code, component: Page }) => (
          <Route key={code} path={path} element={<ModuleRoute code={code}><Suspense fallback={<Spinner />}><Page /></Suspense></ModuleRoute>} />
        ))}
        <Route path="*" element={<EmptyState title="Page not found" action={<Link className="underline" to="/app/dashboard">Go to dashboard</Link>} />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
