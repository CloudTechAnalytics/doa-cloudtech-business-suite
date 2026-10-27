import { Suspense, useEffect, useLayoutEffect } from 'react'
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AppShell } from '@/app/layouts/AppShell'
import { AppsHome } from '@/app/layouts/AppsHome'
import { AppLibraryPage } from '@/core/app-catalogue/AppLibraryPage'
import { AppStartPage } from '@/core/app-catalogue/AppStartPage'
import { AppsPage } from '@/app/landing/AppsPage'
import { HelpPage } from '@/app/landing/HelpPage'
import { LandingPage } from '@/app/landing/LandingPage'
import { PricingPage } from '@/app/landing/PricingPage'
import { SignInPage, SignUpPage } from '@/core/auth/AuthPages'
import { ProfilePage } from '@/core/auth/ProfilePage'
import { EmailConfirmedPage, ForgotPasswordPage, ResetPasswordPage, SetPasswordPage } from '@/core/auth/ResetPages'
import { RequireAuth } from '@/core/auth/AuthProvider'
import { BusinessesPage } from '@/core/businesses/BusinessesPage'
import { OnboardingPage } from '@/core/businesses/OnboardingPage'
import { ModuleRoute } from '@/core/module-registry/ModuleRoute'
import { buildModuleRoutes } from '@/core/module-registry/routes'
import { PlatformBusinessPage, PlatformBusinesses } from '@/core/platform-admin/PlatformBusinesses'
import { PlatformSubscriptions } from '@/core/platform-admin/PlatformSubscriptions'
import { PlatformDashboard } from '@/core/platform-admin/PlatformDashboard'
import { PlatformLayout } from '@/core/platform-admin/PlatformLayout'
import { PlatformAudit, PlatformHealth, PlatformPlans, PlatformTeam, PlatformUsers } from '@/core/platform-admin/PlatformMore'
import { EmptyState, Spinner } from '@/shared/components'

// Built once from the shared modules and the industry registry; adding an industry adds its routes here with no router edits.
const MODULE_ROUTES = buildModuleRoutes()

/** Remounts the picker when the query changes, so a menu link such as /start?type=farm pre-selects that type. */
function StartPage() {
  const { search } = useLocation()
  return <OnboardingPage key={search} />
}

/** The website and Platform console keep the classic navy and amber colours; only the business workspace (/app) uses the ocean palette and its theme. */
function SitePalette() {
  const { pathname } = useLocation()
  useLayoutEffect(() => { document.documentElement.classList.toggle('classic-palette', !pathname.startsWith('/app')) }, [pathname])
  return null
}

/** A new page opens at the top, unless the link points at a section. */
function ScrollToTop() {
  const { pathname, hash } = useLocation()
  useEffect(() => { if (!hash) window.scrollTo(0, 0) }, [pathname, hash])
  return null
}

export function AppRoutes() {
  return (
    <>
    <SitePalette />
    <ScrollToTop />
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/pricing" element={<PricingPage />} />
      <Route path="/apps" element={<AppsPage />} />
      <Route path="/help" element={<HelpPage />} />
      <Route path="/sign-in" element={<SignInPage />} />
      <Route path="/sign-up" element={<SignUpPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/set-password" element={<RequireAuth><SetPasswordPage /></RequireAuth>} />
      <Route path="/email-confirmed" element={<EmailConfirmedPage />} />
      <Route path="/account" element={<RequireAuth><ProfilePage /></RequireAuth>} />
      <Route path="/start" element={<StartPage />} />
      <Route path="/onboarding" element={<StartPage />} />
      <Route path="/start/:appId" element={<RequireAuth><AppStartPage /></RequireAuth>} />
      <Route path="/businesses" element={<RequireAuth><BusinessesPage /></RequireAuth>} />
      <Route path="/platform" element={<RequireAuth><PlatformLayout /></RequireAuth>}>
        <Route index element={<PlatformDashboard />} />
        <Route path="businesses" element={<PlatformBusinesses />} />
        <Route path="businesses/:id" element={<PlatformBusinessPage />} />
        <Route path="subscriptions" element={<PlatformSubscriptions />} />
        <Route path="users" element={<PlatformUsers />} />
        <Route path="plans" element={<PlatformPlans />} />
        <Route path="team" element={<PlatformTeam />} />
        <Route path="audit" element={<PlatformAudit />} />
        <Route path="health" element={<PlatformHealth />} />
      </Route>
      <Route path="/app" element={<RequireAuth><AppShell /></RequireAuth>}>
        <Route index element={<AppsHome />} />
        <Route path="apps" element={<AppLibraryPage />} />
        <Route path="platform-admin" element={<Navigate to="/platform" replace />} />
        {MODULE_ROUTES.map(({ path, code, component: Page }) => (
          <Route key={code} path={path} element={<ModuleRoute code={code}><Suspense fallback={<Spinner />}><Page /></Suspense></ModuleRoute>} />
        ))}
        <Route path="*" element={<EmptyState title="Page not found" action={<Link className="underline" to="/app/dashboard">Go to dashboard</Link>} />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </>
  )
}
