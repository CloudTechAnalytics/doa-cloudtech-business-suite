import clsx from 'clsx'
import { useState } from 'react'
import { Badge, Button, EmptyState, ErrorState, SelectField, Spinner, TextField } from '@/shared/components'
import { Dialog } from '@/shared/components/dialog'
import { useAsync } from '@/shared/hooks/useAsync'
import { useFormRunner } from '@/shared/hooks/useFormRunner'
import { dateTime, label, naira } from '@/shared/utilities/format'
import { DEAL_STAGES, OPEN_STAGES, dealEvents, listContacts, listDeals, moveDeal, saveDeal } from './dealsApi'
import type { Contact, DealRow, DealStage } from './dealsApi'

const STAGE_COLOR: Record<DealStage, string> = { new: '#1c7ed6', qualified: '#7048e8', proposal: '#e8590c', negotiation: '#f08c00', won: '#2f9e44', lost: '#868e96' }
const today = () => new Date().toISOString().slice(0, 10)

/** The deal pipeline: one column per stage. Drag a card to another column, or use its "Move to" menu (touch screens). Losing a deal asks why. */
export function Pipeline({ businessId, can }: { businessId: string; can: (p: string) => boolean }) {
  const deals = useAsync(() => listDeals(businessId), [businessId])
  const [editing, setEditing] = useState<DealRow | 'new' | null>(null)
  const [losing, setLosing] = useState<DealRow | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)
  const [showClosed, setShowClosed] = useState(true)
  const manage = can('customers.manage')
  if (deals.loading && !deals.data) return <Spinner />
  const rows = deals.data ?? []

  async function move(d: DealRow, stage: DealStage) {
    if (stage === d.stage) return
    if (stage === 'lost') return setLosing(d)
    setError(await moveDeal(businessId, d.id, stage))
    await deals.refresh()
  }
  const open = rows.filter((d) => OPEN_STAGES.includes(d.stage))
  const stages = showClosed ? DEAL_STAGES : OPEN_STAGES

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <p className="text-sm text-ink/70"><b>{open.length}</b> open {open.length === 1 ? 'deal' : 'deals'} worth <b>{naira(open.reduce((a, d) => a + d.value, 0))}</b></p>
        <label className="ml-auto flex items-center gap-2 text-sm"><input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} /> Show won and lost</label>
        {manage && <Button onClick={() => setEditing('new')}>Add deal</Button>}
      </div>
      {(error || deals.error) && <ErrorState message={error ?? deals.error!} />}
      {rows.length === 0 && <EmptyState title="No deals yet" description="A deal is a possible sale to a customer or lead. Add one and move it along as it progresses." />}
      <div className={clsx('grid gap-3', stages.length > 4 ? 'md:grid-cols-3 xl:grid-cols-6' : 'md:grid-cols-2 xl:grid-cols-4')}>
        {stages.map((stage) => {
          const list = rows.filter((d) => d.stage === stage)
          return (
            <section key={stage} aria-label={`${label(stage)} deals`} className="min-w-0 rounded-lg border border-line bg-surface/60 p-2"
              onDragOver={(e) => { if (manage) e.preventDefault() }}
              onDrop={() => { const d = rows.find((x) => x.id === dragging); setDragging(null); if (d && manage) void move(d, stage) }}>
              <header className="mb-2 flex items-baseline justify-between gap-2 border-b-2 px-1 pb-1" style={{ borderColor: STAGE_COLOR[stage] }}>
                <h3 className="text-xs font-bold uppercase tracking-wide" style={{ color: STAGE_COLOR[stage] }}>{label(stage)}</h3>
                <span className="text-[11px] text-ink/60">{list.length} · {naira(list.reduce((a, d) => a + d.value, 0))}</span>
              </header>
              <ul className="space-y-2">
                {list.map((d) => {
                  const late = !!d.expectedClose && d.expectedClose < today() && OPEN_STAGES.includes(d.stage)
                  return (
                    <li key={d.id} draggable={manage} onDragStart={() => setDragging(d.id)} onDragEnd={() => setDragging(null)} className="rounded-md border border-line bg-white p-2 text-sm shadow-card">
                      <button className="block w-full text-left" onClick={() => setEditing(d)}>
                        <b className="block break-words">{d.title}</b>
                        <span className="block text-xs text-ink/60">{d.contact || '–'}</span>
                        <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs"><b>{naira(d.value)}</b>{d.expectedClose && <Badge tone={late ? 'danger' : 'neutral'}>{late ? 'Late · ' : 'By '}{d.expectedClose}</Badge>}</span>
                        {d.stage === 'lost' && d.lostReason && <span className="mt-1 block text-xs text-ink/60">Lost: {d.lostReason}</span>}
                      </button>
                      {manage && (
                        <select aria-label={`Move ${d.title} to`} value={d.stage} onChange={(e) => void move(d, e.target.value as DealStage)} className="mt-2 w-full rounded border border-line bg-white px-1.5 py-1 text-xs">
                          {DEAL_STAGES.map((s) => <option key={s} value={s}>{s === d.stage ? label(s) : `Move to ${label(s)}`}</option>)}
                        </select>
                      )}
                    </li>
                  )
                })}
                {list.length === 0 && <li className="px-1 py-3 text-center text-xs text-ink/45">Nothing here</li>}
              </ul>
            </section>
          )
        })}
      </div>
      {editing && <DealDialog businessId={businessId} deal={editing === 'new' ? null : editing} manage={manage} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await deals.refresh() }} />}
      {losing && <LostDialog businessId={businessId} deal={losing} onClose={() => setLosing(null)} onDone={async () => { setLosing(null); await deals.refresh() }} />}
    </>
  )
}

function LostDialog({ businessId, deal, onClose, onDone }: { businessId: string; deal: DealRow; onClose: () => void; onDone: () => Promise<void> }) {
  const [reason, setReason] = useState('')
  const runner = useFormRunner(onDone)
  return (
    <Dialog title={`Mark "${deal.title}" as lost`} onClose={onClose}>
      <div className="space-y-3 text-sm">
        <TextField label="Why was it lost?" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Price too high, chose a competitor, no response…" />
        {runner.error && <ErrorState title="Not saved" message={runner.error} />}
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={runner.busy} onClick={() => void runner.run(async () => moveDeal(businessId, deal.id, 'lost', reason), 'Saved.')}>Mark as lost</Button></div>
      </div>
    </Dialog>
  )
}

function DealDialog({ businessId, deal, manage, onClose, onSaved }: { businessId: string; deal: DealRow | null; manage: boolean; onClose: () => void; onSaved: () => Promise<void> }) {
  const contacts = useAsync(() => listContacts(businessId), [businessId])
  const history = useAsync(() => (deal ? dealEvents(businessId, deal.id) : Promise.resolve([])), [businessId, deal?.id])
  const [title, setTitle] = useState(deal?.title ?? '')
  const [contact, setContact] = useState(deal ? (deal.customerId ? `customer:${deal.customerId}` : `lead:${deal.leadId}`) : '')
  const [value, setValue] = useState(deal ? String(deal.value) : '')
  const [expected, setExpected] = useState(deal?.expectedClose ?? '')
  const [notes, setNotes] = useState(deal?.notes ?? '')
  const runner = useFormRunner(onSaved)
  const pick = (c: Contact) => `${c.kind}:${c.id}`
  const [kind, id] = contact.split(':')
  const list = contacts.data ?? []
  // A contact that has since been converted (or is not in the first page) still shows by name.
  const known = list.some((c) => pick(c) === contact)
  return (
    <Dialog title={deal ? 'Deal' : 'Add deal'} onClose={onClose} wide>
      <div className="space-y-3 text-sm">
        <TextField label="What is the deal for?" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Weekly supply, website redesign, party order…" disabled={!manage} />
        <SelectField label="With" value={contact} onChange={(e) => setContact(e.target.value)} disabled={!manage}>
          <option value="">Choose a customer or lead</option>
          {deal && !known && contact && <option value={contact}>{deal.contact || 'Current contact'}</option>}
          {list.filter((c) => c.kind === 'customer').length > 0 && <optgroup label="Customers">{list.filter((c) => c.kind === 'customer').map((c) => <option key={pick(c)} value={pick(c)}>{c.name}</option>)}</optgroup>}
          {list.filter((c) => c.kind === 'lead').length > 0 && <optgroup label="Leads">{list.filter((c) => c.kind === 'lead').map((c) => <option key={pick(c)} value={pick(c)}>{c.name}</option>)}</optgroup>}
        </SelectField>
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="Value (₦)" type="number" min={0} value={value} onChange={(e) => setValue(e.target.value)} disabled={!manage} />
          <TextField label="Expected close date" type="date" value={expected} onChange={(e) => setExpected(e.target.value)} disabled={!manage} />
        </div>
        <TextField label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} disabled={!manage} />
        {deal?.stage === 'lost' && deal.lostReason && <p className="rounded-md bg-surface px-3 py-2 text-xs">Lost because: {deal.lostReason}</p>}
        {runner.error && <ErrorState title="Not saved" message={runner.error} />}
        {manage && <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={runner.busy} onClick={() => void runner.run(async () => saveDeal(businessId, { id: deal?.id ?? null, title, customerId: kind === 'customer' ? id : null, leadId: kind === 'lead' ? id : null, value: Number(value || 0), expectedClose: expected || null, notes }), 'Saved.')}>Save deal</Button></div>}
        {deal && (history.data?.length ?? 0) > 0 && (
          <div><h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink/60">History</h4>
            <ul className="space-y-0.5 text-xs">{history.data!.map((h, i) => <li key={i}>{dateTime(h.at)}: {h.from ? `${label(h.from)} → ${label(h.to)}` : `Created as ${label(h.to)}`}{h.note ? ` (${h.note})` : ''}</li>)}</ul></div>
        )}
      </div>
    </Dialog>
  )
}
