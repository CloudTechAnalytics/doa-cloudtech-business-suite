import { Link } from 'react-router-dom'
import { BrandLockup } from '@/app/layouts/Brand'

export function SiteFooter() {
  return (
    <footer className="bg-white">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-8 text-sm text-ink/60 sm:px-6">
        <BrandLockup />
        <span>&copy; {new Date().getFullYear()} CloudTech Analytics</span>
        <span className="flex gap-5"><Link to="/pricing" className="hover:text-ink">Pricing</Link><Link to="/help" className="hover:text-ink">Help</Link><Link to="/sign-in" className="hover:text-ink">Sign in</Link><Link to="/start" className="hover:text-ink">Try it free</Link></span>
      </div>
    </footer>
  )
}
