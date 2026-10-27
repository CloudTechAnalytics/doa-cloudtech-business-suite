import clsx from 'clsx'
import { Download } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useAuth } from '@/core/auth/AuthProvider'
import { Badge, Button, Card, EmptyState, ErrorState, SelectField, Spinner, TextField } from '@/shared/components'
import { useAsync } from '@/shared/hooks/useAsync'
import { downloadCsv } from '@/shared/utilities/csvExport'
import { naira } from '@/shared/utilities/format'
import { DealDialog, LostDialog } from './CrmDeals'
import { listDeals, listStages, listTeam, moveDeal } from './dealsApi'
import type { DealRow, StageRow } from './dealsApi'

type Sort = 'newest' | 'value' | 'close' | 'quiet'
const SORTS: [Sort, string][] = [['newest', 'Newest first'], ['value', 'Biggest first'], ['close', 'Closing soonest'], ['quiet', 'Quiet longest']]

export function sortDeals(rows: DealRow[], sort: Sort): DealRow[] {
  const by: Record<Sort, (a: DealRow, z: DealRow) => number> = {
    newest: (a, z) => z.createdAt.localeCompare(a.createdAt),
    value: (a, z) => z.value - a.value,
    close: (a, z) => (a.expectedClose ?? '9999').localeCompare(z.expectedClose ?? '9999'),
    quiet: (a, z) => a.lastMovedAt.localeCompare(z.lastMovedAt),
  }
  return [...rows].sort(by[sort])
}

/** The same deals as the pipeline board, as a list you can search, filter, sort and export. Opening a deal gives the same page as on the board. */
export function DealsList({ businessId, can }: { businessId: string; can: (p: string) => boolean }) {
  const { userId } = useAuth()
  const deals = useAsync(() => listDeals(businessId), [businessId])
  const stages = useAsync(() => listStages(businessId), [businessId])
  const team = useAsync(() => listTeam(businessId), [businessId])
  const [q, setQ] = useState(''); const [status, setStatus] = useState<'open' | 'won' | 'lost' | 'all'>('open'); const [stage, setStage] = useState(''); const [owner, setOwner] = useState('all'); const [sort, setSort] = useState<Sort>('newest')
  const [editing, setEditing] = useState<DealRow | 'new' | null>(null)
  const [losing, setLosing] = useState<{ deal: DealRow; stage: StageRow } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const manage = can('customers.manage')
  const st = stages.data ?? []
  const rows = useMemo(() => {
    const term = q.trim().toLowerCase()
    return sortDeals((deals.data ?? []).filter((d) =>
      (status === 'all' || d.stageKind === status) && (!stage || d.stageId === stage) && (owner === 'all' || (owner === 'mine' ? d.ownerId === userId : d.ownerId === owner))
      && (!term || [d.title, d.contact, d.ownerName, d.nextStep].some((v) => v?.toLowerCase().includes(term)))), sort)
  }, [deals.data, q, status, stage, owner, sort, userId])
  const refresh = async () => { await Promise.all([deals.refresh(), stages.refresh()]) }
  const total = rows.reduce((a, d) => a + d.value, 0)
  const weighted = rows.filter((d) => d.stageKind === 'open').reduce((a, d) => a + (d.value * d.probability) / 100, 0)

  async function move(d: DealRow, s: StageRow) {
    if (s.id === d.stageId) return
    if (s.kind === 'lost') return setLosing({ deal: d, stage: s })
    setError(await moveDeal(businessId, d.id, s.id)); await refresh()
  }

  if ((deals.loading && !deals.data) || (stages.loading && !stages.data)) return <Spinner />
  return (
    <>
      <div className="mb-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <TextField label="Search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Deal, contact, owner or next step" />
        <SelectField label="Status" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}><option value="open">Open</option><option value="won">Won</option><option value="lost">Lost</option><option value="all">All</option></SelectField>
        <SelectField label="Stage" value={stage} onChange={(e) => setStage(e.target.value)}><option value="">Any stage</option>{st.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</SelectField>
        <SelectField label="Owner" value={owner} onChange={(e) => setOwner(e.target.value)}><option value="all">Everyone</option><option value="mine">My deals</option>{(team.data ?? []).map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}</SelectField>
        <SelectField label="Sort" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>{SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</SelectField>
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <p className="text-sm text-ink/70"><b>{rows.length}</b> {rows.length === 1 ? 'deal' : 'deals'} · worth <b>{naira(total)}</b>{status === 'open' || status === 'all' ? <> · likely to close <b>{naira(weighted)}</b></> : null}</p>
        <div className="ml-auto flex gap-2">
          {rows.length > 0 && <Button variant="secondary" onClick={() => downloadCsv('deals.csv', dealsExport(rows))}><Download className="size-4" aria-hidden /> Export deals</Button>}
          {manage && <Button onClick={() => setEditing('new')}>Add deal</Button>}
        </div>
      </div>
      {(error || deals.error) && <ErrorState message={error ?? deals.error!} />}
      {rows.length === 0 ? <EmptyState title="No deals match" description={(deals.data ?? []).length ? 'Try clearing the filters.' : 'Add your first deal, or open Pipeline to see the board.'} /> : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-surface text-left text-xs font-semibold text-ink/70"><tr><th className="p-3">Deal</th><th className="p-3">Stage</th><th className="p-3 text-right">Value</th><th className="p-3 text-right">Chance</th><th className="p-3">Owner</th><th className="p-3">Closing</th><th className="p-3">Next step</th></tr></thead>
            <tbody className="divide-y divide-ink/10">
              {rows.map((d) => (
                <tr key={d.id} onClick={(e) => { if (!(e.target as HTMLElement).closest('select')) setEditing(d) }} className="cursor-pointer hover:bg-surface">
                  <td className="p-3"><b>{d.title}</b>{d.stale && <Badge tone="warning">Gone quiet</Badge>}<div className="text-xs text-ink/60">{d.contact || 'No contact'}</div></td>
                  <td className="p-3">
                    {manage && d.stageKind === 'open'
                      ? <select aria-label={`Stage of ${d.title}`} value={d.stageId} onChange={(e) => { const s = st.find((x) => x.id === e.target.value); if (s) void move(d, s) }} className="rounded border border-line bg-white px-2 py-1 text-xs">{st.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
                      : <span className={clsx('rounded-md px-2 py-0.5 text-xs font-medium', d.stageKind === 'won' ? 'bg-success-soft text-success' : d.stageKind === 'lost' ? 'bg-surface text-ink/70' : 'bg-surface')}>{d.stageName}</span>}
                  </td>
                  <td className="p-3 text-right tabular-nums">{naira(d.value)}</td>
                  <td className="p-3 text-right tabular-nums">{d.stageKind === 'open' ? `${d.probability}%` : '–'}</td>
                  <td className="p-3">{d.ownerName ?? '–'}</td>
                  <td className="p-3 whitespace-nowrap">{d.expectedClose ?? '–'}</td>
                  <td className="p-3 text-ink/70">{d.stageKind === 'lost' ? d.lostReason ?? '' : d.nextStep || '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      {editing && <DealDialog businessId={businessId} deal={editing === 'new' ? null : editing} manage={manage} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await refresh() }} />}
      {losing && <LostDialog businessId={businessId} deal={losing.deal} stage={losing.stage} onClose={() => setLosing(null)} onDone={async () => { setLosing(null); await refresh() }} />}
    </>
  )
}

/** The rows on screen as a CSV file you can open in Excel. */
export function dealsExport(rows: DealRow[]): (string | number | null)[][] {
  return [
    ['Deal', 'Contact', 'Stage', 'Status', 'Value', 'Chance of winning (%)', 'Owner', 'Expected close', 'Next step', 'Lost reason', 'Created'],
    ...rows.map((d) => [d.title, d.contact, d.stageName, d.stageKind, d.value, d.stageKind === 'open' ? d.probability : null, d.ownerName, d.expectedClose, d.nextStep, d.lostReason, d.createdAt.slice(0, 10)]),
  ]
}
