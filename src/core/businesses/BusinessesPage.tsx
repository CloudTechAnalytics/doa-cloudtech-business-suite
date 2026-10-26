import { ChevronDown, ChevronRight, LayoutGrid, LogOut, Settings, ShieldCheck, Trash2, UserCircle } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { SiteNav } from '@/app/landing/SiteNav'
import { BrandLockup } from '@/app/layouts/Brand'
import { industryColor } from '@/app/navigation/navigation'
import { useAuth } from '@/core/auth/AuthProvider'
import { useBusiness } from '@/core/business-context/BusinessProvider'
import { getIndustry } from '@/core/industry-registry'
import { archiveBusiness } from '@/core/businesses/businessActions'
import { usePlatformRole } from '@/core/platform-admin/platformUi'
import type { BusinessSummary } from '@/core/business-context/BusinessProvider'
import { Badge, Button, ErrorState, Spinner } from '@/shared/components'
import { Dialog } from '@/shared/components/dialog'
import { Menu } from '@/shared/components/menu'

const roleLabel = (role: string) => role.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())

/** Owner-only: deleting archives the business (its records are kept), after typing its exact name. */
function DeleteDialog({ business, onClose, onDeleted }: { business: BusinessSummary; onClose: () => void; onDeleted: () => void }) {
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null)
    const err = await archiveBusiness(business.id, typed)
    setBusy(false)
    if (err) setError(err)
    else onDeleted()
  }
  return (
    <Dialog title="Delete business" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-ink/80">
          <strong>{business.name}</strong> will disappear for you and everyone on its team. Its records are kept, not erased. Type the business name to confirm.
        </p>
        <input
          autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} aria-label="Business name" placeholder={business.name}
          className="h-11 w-full rounded-md border border-line px-3 text-[15px] outline-none focus:border-amber focus:ring-2 focus:ring-amber/30"
        />
        {error && <ErrorState title="Could not delete" message={error} />}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={busy} disabled={typed.trim() !== business.name} className="bg-danger text-white hover:bg-danger/90">Delete business</Button>
        </div>
      </form>
    </Dialog>
  )
}

/**
 * Where a signed-in visitor lands: every business they belong to, and a button to open one. Choosing one sets it as
 * the active business (the list itself is only what RLS lets this user read).
 */
export function BusinessesPage() {
  const navigate = useNavigate()
  const { email, signOut } = useAuth()
  const { businesses, loading, error, select, refresh } = useBusiness()
  const [deleting, setDeleting] = useState<BusinessSummary | null>(null)
  const platform = usePlatformRole()

  if (loading || platform.loading) return <Spinner />
  // A platform admin with no business of their own lands in the console, not on the new-business form.
  if (!businesses.length && !error) return <Navigate to={platform.data ? '/platform' : '/start'} replace />

  const open = (id: string) => { select(id); navigate('/app') }

  return (
    <div className="min-h-dvh bg-white">
      <header className="sticky top-0 z-30 border-b border-line/60 bg-surface">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link to="/" aria-label="DOA home"><BrandLockup /></Link>
          <SiteNav />
          <Menu
            label="Account menu"
            trigger={({ toggle }) => (
              <button type="button" onClick={toggle} aria-haspopup="menu" aria-label="Account menu" className="inline-flex h-9 items-center gap-1 rounded-md px-2 text-ink/80 hover:bg-white hover:text-ink">
                <UserCircle className="size-6" aria-hidden /><ChevronDown className="size-4" aria-hidden />
              </button>
            )}
            items={[
              { label: email ?? 'Account', heading: true },
              { label: 'My businesses', to: '/businesses', icon: <LayoutGrid className="size-4" /> },
              ...(platform.data ? [{ label: 'Platform console', to: '/platform', icon: <ShieldCheck className="size-4" /> }] : []),
              { label: 'Sign out', icon: <LogOut className="size-4" />, onSelect: signOut, divider: true },
            ]}
          />
        </div>
      </header>

      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-8 sm:px-6">
        <h1 className="text-3xl font-bold text-ink sm:text-4xl">Your businesses</h1>
        <Link to="/start" className="inline-flex h-10 items-center rounded-md bg-amber px-5 text-sm font-bold text-ink hover:bg-amber-dark">Create</Link>
      </div>

      {error && <div className="mx-auto max-w-5xl px-4 sm:px-6"><ErrorState title="Could not load your businesses" message={error} /></div>}

      <ul className="border-y border-line bg-surface">
        {businesses.map((b) => {
          const d = getIndustry(b.industry)
          return (
            <li key={b.id} className="border-b border-line last:border-b-0">
              <div className="mx-auto flex max-w-5xl items-center gap-4 px-4 py-4 sm:px-6">
                <span className="grid size-11 shrink-0 place-items-center rounded-lg text-white" style={{ background: industryColor(b.industry) }}>
                  <d.icon className="size-5" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-lg font-bold text-ink/80">{b.name}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-2 text-sm text-ink/60">
                    {d.name}
                    {b.role && <Badge>{roleLabel(b.role)}</Badge>}
                  </p>
                </div>
                {b.isOwner && (
                  <Menu
                    label={`${b.name} options`}
                    trigger={({ toggle }) => (
                      <button type="button" onClick={toggle} aria-haspopup="menu" aria-label={`${b.name} options`} className="grid size-9 place-items-center rounded-md text-ink/50 hover:bg-white hover:text-ink">
                        <Settings className="size-5" aria-hidden />
                      </button>
                    )}
                    items={[{ label: 'Delete business', icon: <Trash2 className="size-4 text-danger" />, onSelect: () => setDeleting(b) }]}
                  />
                )}
                <button
                  type="button" onClick={() => open(b.id)} aria-label={`Connect to ${b.name}`}
                  className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-md bg-amber px-5 text-base font-bold text-ink hover:bg-amber-dark"
                >
                  Connect <ChevronRight className="size-5" aria-hidden />
                </button>
              </div>
            </li>
          )
        })}
      </ul>
      {deleting && <DeleteDialog business={deleting} onClose={() => setDeleting(null)} onDeleted={() => { setDeleting(null); void refresh() }} />}
    </div>
  )
}
