import { ArrowRight, ChevronDown, LayoutGrid, LogOut, Plus, Search, Settings, ShieldCheck, Trash2, UserCircle } from 'lucide-react'
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
import { useProfile } from '@/core/auth/useProfile'
import { arrange, firstName, greeting, needsSearch, roleLine } from './chooser'
import type { BusinessSummary } from '@/core/business-context/BusinessProvider'
import { Button, ErrorState, Spinner } from '@/shared/components'
import { Dialog } from '@/shared/components/dialog'
import { AccessSuspended } from '@/app/layouts/AccessSuspended'
import { Menu } from '@/shared/components/menu'

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
  const { businesses, active, blocked, loading, error, select, refresh } = useBusiness()
  const [deleting, setDeleting] = useState<BusinessSummary | null>(null)
  const [query, setQuery] = useState('')
  const platform = usePlatformRole()
  const profile = useProfile()

  if (loading || platform.loading) return <Spinner />
  // Someone whose only access was suspended is told so, rather than being offered a new business.
  if (!businesses.length && blocked.length && !platform.data) return <AccessSuspended blocked={blocked} />
  // A platform admin with no business of their own lands in the console, not on the new-business form.
  if (!businesses.length && !error) return <Navigate to={platform.data ? '/platform' : '/start'} replace />

  const open = (id: string) => { select(id); navigate('/app') }
  const shown = arrange(businesses, active?.id ?? null, (b) => getIndustry(b.industry).name, query)

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

      <section className="border-b border-line/70 bg-gradient-to-br from-[#eef6fb] via-white to-[#fff6e5]">
        <div className="mx-auto flex max-w-5xl flex-wrap items-end justify-between gap-4 px-4 py-9 sm:px-6 sm:py-12">
          <div>
            <p className="text-sm font-semibold text-ink/55">{greeting(new Date().getHours())}{firstName(profile.name) ? `, ${firstName(profile.name)}` : ''}</p>
            <h1 className="mt-1 text-3xl font-extrabold tracking-tight text-ink sm:text-4xl">Which business today?</h1>
            <p className="mt-2 text-sm text-ink/65">{businesses.length === 1 ? 'You have one business.' : `You have ${businesses.length} businesses.`} Open one to get to work, or start another: each has its own team, records and plan.</p>
          </div>
          <Link to="/start" className="inline-flex h-11 items-center gap-2 rounded-full bg-ink px-5 text-sm font-bold text-white shadow-card hover:bg-ink/90"><Plus className="size-4" aria-hidden /> New business</Link>
        </div>
      </section>

      {error && <div className="mx-auto max-w-5xl px-4 pt-6 sm:px-6"><ErrorState title="Could not load your businesses" message={error} /></div>}

      <main className="mx-auto max-w-5xl px-4 pb-14 pt-8 sm:px-6">
        {needsSearch(businesses.length) && (
          <label className="relative mb-5 block max-w-sm">
            <span className="sr-only">Find a business</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink/50" aria-hidden />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a business" className="h-10 w-full rounded-full border border-line bg-white pl-9 pr-3 text-sm" />
          </label>
        )}
        {shown.length === 0 && <p className="py-10 text-center text-ink/60">No business matches &ldquo;{query}&rdquo;.</p>}
        <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((b) => {
            const d = getIndustry(b.industry); const color = industryColor(b.industry)
            return (
              <li key={b.id} className="group relative overflow-hidden rounded-2xl border border-line bg-white shadow-card transition hover:-translate-y-0.5 hover:shadow-raised">
                <div className="flex items-start justify-between gap-3 px-5 pb-10 pt-5 text-white" style={{ background: `linear-gradient(135deg, ${color}, color-mix(in srgb, ${color} 55%, white))` }}>
                  <span className="grid size-11 place-items-center rounded-xl bg-white/20 ring-1 ring-white/40"><d.icon className="size-6" aria-hidden /></span>
                  <div className="flex items-center gap-1">
                    {b.id === active?.id && <span className="rounded-full bg-white/25 px-2.5 py-0.5 text-[11px] font-semibold">Last opened</span>}
                    {b.isOwner && (
                      <Menu
                        label={`${b.name} options`}
                        trigger={({ toggle }) => <button type="button" onClick={toggle} aria-haspopup="menu" aria-label={`${b.name} options`} className="grid size-8 place-items-center rounded-full text-white/85 hover:bg-white/20"><Settings className="size-[18px]" aria-hidden /></button>}
                        items={[{ label: 'Delete business', icon: <Trash2 className="size-4 text-danger" />, onSelect: () => setDeleting(b) }]}
                      />
                    )}
                  </div>
                </div>
                <div className="-mt-5 rounded-t-2xl bg-white px-5 pb-5 pt-4">
                  <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color }}>{d.name}</p>
                  <h2 className="mt-0.5 truncate text-xl font-bold text-ink">{b.name}</h2>
                  <p className="mt-1 text-sm text-ink/60">{roleLine(b)}</p>
                  <button type="button" onClick={() => open(b.id)} aria-label={`Open ${b.name}`} className="mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-amber text-sm font-bold text-ink hover:bg-amber-dark">Open <ArrowRight className="size-4 transition group-hover:translate-x-0.5" aria-hidden /></button>
                </div>
              </li>
            )
          })}
          {!query.trim() && (
            <li>
              <Link to="/start" className="flex h-full min-h-56 flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-line bg-surface/50 p-6 text-center text-ink/70 transition hover:border-ink/30 hover:bg-surface">
                <span className="grid size-11 place-items-center rounded-full bg-white shadow-card"><Plus className="size-5" aria-hidden /></span>
                <span className="font-semibold text-ink">Start another business</span>
                <span className="text-xs">A shop, farm, bakery, pharmacy, school, or just the apps you need.</span>
              </Link>
            </li>
          )}
        </ul>
      </main>
      {deleting && <DeleteDialog business={deleting} onClose={() => setDeleting(null)} onDeleted={() => { setDeleting(null); void refresh() }} />}
    </div>
  )
}
