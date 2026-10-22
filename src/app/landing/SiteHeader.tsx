import { Link } from 'react-router-dom'
import { BrandLockup } from '@/app/layouts/Brand'
import { SiteNav } from './SiteNav'

/**
 * The public site's header, shared by the landing page and the "Choose your business" pages so the Apps and
 * Industries menus are always there. It is always the public pair: if a session exists, /sign-in sends the
 * visitor straight to their apps.
 */
export function SiteHeader() {
  return (
    <header className="anim-header sticky top-0 z-30 border-b border-line/60 bg-gradient-to-r from-white via-[#f7fafd] to-white shadow-[0_1px_0_rgb(255_255_255),0_6px_18px_-14px_rgb(11_42_74/0.35)]">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link to="/" aria-label="DOA home"><BrandLockup /></Link>
        <SiteNav />
        <div className="flex items-center gap-3">
          <Link to="/sign-in" className="text-sm font-medium text-ink/80 hover:text-ink">Sign in</Link>
          <Link to="/start" className="inline-flex h-9 items-center rounded-md bg-amber px-4 text-sm font-bold text-ink shadow-card transition hover:-translate-y-px hover:bg-amber-dark">Try it free</Link>
        </div>
      </div>
    </header>
  )
}
