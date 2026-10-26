import { createContext, useContext } from 'react'
import { Link } from 'react-router-dom'
import { INDUSTRIES } from '@/core/industry-registry'
import { useAuth } from '@/core/auth/AuthProvider'
import { Badge, Card } from '@/shared/components'
import { useAsync } from '@/shared/hooks/useAsync'
import { label } from '@/shared/utilities/format'
import { platformRole } from './platformApi'
import type { BusinessState, PlatformRole, SubStatus } from './platformApi'

export interface PlatformCtx { role: PlatformRole; canWrite: boolean; isOwner: boolean }
export const PlatformContext = createContext<PlatformCtx>({ role: 'support', canWrite: false, isOwner: false })
export const usePlatform = () => useContext(PlatformContext)

/** The signed-in person's platform role (null for everyone else), looked up once per sign-in. */
export function usePlatformRole() {
  const { userId } = useAuth()
  return useAsync(() => (userId ? platformRole() : Promise.resolve(null)), [userId])
}

export const industryName = (code: string) => (code in INDUSTRIES ? INDUSTRIES[code as keyof typeof INDUSTRIES].name : label(code))
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
