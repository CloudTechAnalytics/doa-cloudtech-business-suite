import { createContext, useContext } from 'react'
import { Link } from 'react-router-dom'
import { appName } from '@/core/app-catalogue/apps'
import { INDUSTRIES } from '@/core/industry-registry'
import { useAuth } from '@/core/auth/AuthProvider'
import { Badge, Card } from '@/shared/components'
import { useAsync } from '@/shared/hooks/useAsync'
import { label } from '@/shared/utilities/format'
import { loadHealth, loadOverview, platformRole } from './platformApi'
import type { Attention } from '@/shared/topbar/TopBar'
import type { BusinessState, PlatformRole, SubStatus } from './platformApi'

export interface PlatformCtx { role: PlatformRole; canWrite: boolean; isOwner: boolean }
export const PlatformContext = createContext<PlatformCtx>({ role: 'support', canWrite: false, isOwner: false })
export const usePlatform = () => useContext(PlatformContext)

/** The signed-in person's platform role (null for everyone else), looked up once per sign-in. */
export function usePlatformRole() {
  const { userId } = useAuth()
  return useAsync(() => (userId ? platformRole() : Promise.resolve(null)), [userId])
}

/** A Business apps workspace has no industry, so it is shown as what it is: an apps workspace (its apps are listed beside it). */
export const industryName = (code: string) => (code === 'general' ? 'Apps workspace' : code in INDUSTRIES ? INDUSTRIES[code as keyof typeof INDUSTRIES].name : label(code))

/** The apps a workspace has on, as small chips. The app it started with is marked. */
export function AppChips({ apps, startedWith }: { apps: string[]; startedWith?: string | null }) {
  if (!apps.length) return <span className="text-xs text-ink/60">No apps on</span>
  return <span className="flex flex-wrap gap-1">{apps.map((a) => <Badge key={a} tone={a === startedWith ? 'info' : 'neutral'}>{appName(a).replace('DOA ', '')}{a === startedWith ? ' (started)' : ''}</Badge>)}</span>
}
export const day = (iso: string | null | undefined) => (iso ? String(iso).slice(0, 10) : '–')
export const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' }) : '–')
export const daysFrom = (iso: string | null | undefined) => (iso ? Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000) : null)

const SUB_TONE: Record<SubStatus, 'success' | 'info' | 'warning' | 'danger' | 'neutral'> = { active: 'success', trialing: 'info', past_due: 'warning', canceled: 'neutral', expired: 'danger' }
export const SUB_LABEL: Record<SubStatus, string> = { active: 'Paid', trialing: 'On trial', past_due: 'Past due', canceled: 'Cancelled', expired: 'Expired' }
export function SubBadge({ status }: { status: SubStatus | null }) { return status ? <Badge tone={SUB_TONE[status]}>{SUB_LABEL[status]}</Badge> : <Badge>None</Badge> }
export function StateBadge({ status }: { status: BusinessState }) { return <Badge tone={status === 'active' ? 'success' : status === 'suspended' ? 'danger' : 'neutral'}>{label(status)}</Badge> }

export function Kpi({ title, value, note, to, tone }: { title: string; value: string; note?: string; to?: string; tone?: 'warn' | 'good' | 'bad' }) {
  const body = (
    <Card className="h-full transition hover:-translate-y-0.5 hover:shadow-raised">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink/55">{title}</p>
      <p className={`tabular mt-2 text-3xl font-bold ${tone === 'warn' ? 'text-warning' : tone === 'good' ? 'text-success' : tone === 'bad' ? 'text-danger' : ''}`}>{value}</p>
      {note && <p className="mt-1 text-xs text-ink/60">{note}</p>}
    </Card>
  )
  return to ? <Link to={to} className="block h-full">{body}</Link> : body
}

/** What needs the platform team's attention, from real records: trials about to end, payments overdue, and any failing data check. */
export function usePlatformAttention() {
  const r = useAsync(async (): Promise<Attention[]> => {
    const [o, h] = await Promise.all([loadOverview(), loadHealth()])
    const items: Attention[] = []
    if (o.trialsEnding.length) items.push({ key: 'trials', label: `${o.trialsEnding.length} trial${o.trialsEnding.length === 1 ? '' : 's'} ending within 7 days`, detail: o.trialsEnding.map((t) => t.name).slice(0, 3).join(', '), to: '/platform/subscriptions', tone: 'warn' })
    if (o.pastDue) items.push({ key: 'due', label: `${o.pastDue} subscription${o.pastDue === 1 ? '' : 's'} past due`, to: '/platform/subscriptions', tone: 'bad' })
    for (const c of h.checks.filter((x) => !x.ok)) items.push({ key: c.name, label: c.name, detail: c.detail, to: '/platform/health', tone: 'warn' })
    return items
  }, [])
  return { items: r.data ?? [], loading: r.loading, refresh: r.refresh }
}
