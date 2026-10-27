import clsx from 'clsx'
import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { CSSProperties } from 'react'
import { useAuth } from '@/core/auth/AuthProvider'
import { Badge, Button, Card, ErrorState, SelectField, Spinner, TextField } from '@/shared/components'
import { Dialog } from '@/shared/components/dialog'
import { useAsync } from '@/shared/hooks/useAsync'
import { useFormRunner } from '@/shared/hooks/useFormRunner'
import { dateTime, label, naira } from '@/shared/utilities/format'
import { ContactActions } from './ContactActions'
import { ACTIVITY_KINDS, dealEvents, dealInteractions, deleteStage, listActivities, listContacts, listDeals, listStages, listTeam, logOnDeal, moveDeal, reorderStages, saveDeal, saveStage, setNextStep, createActivity } from './dealsApi'
import type { ActivityKind, Contact, DealRow, StageRow } from './dealsApi'

const PALETTE = ['#1c7ed6', '#7048e8', '#e8590c', '#f08c00', '#0ca678', '#d6336c', '#5c940d', '#4263eb']
const colorOf = (s: StageRow, i: number) => (s.kind === 'won' ? '#2f9e44' : s.kind === 'lost' ? '#868e96' : PALETTE[i % PALETTE.length])
const today = () => new Date().toISOString().slice(0, 10)
const initials = (name: string | null) => (name ?? '?').split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase()

/**
 * The deal pipeline, as in the CRMs people already know: your own stages with a chance of winning, so the board shows what is likely to close (the weighted value);
 * deals have an owner and a next step; ones nobody has touched for two weeks are flagged; and a call, WhatsApp or email is one tap from the card.
 */
export function Pipeline({ businessId, can, onGo }: { businessId: string; can: (p: string) => boolean; onGo: (tab: 'Customers' | 'Leads' | 'Activities' | 'Quotes') => void }) {
  const { userId } = useAuth()
  const stages = useAsync(() => listStages(businessId), [businessId])
  const deals = useAsync(() => listDeals(businessId), [businessId])
  const team = useAsync(() => listTeam(businessId), [businessId])
  const [editing, setEditing] = useState<DealRow | 'new' | null>(null)
  const [losing, setLosing] = useState<{ deal: DealRow; stage: StageRow } | null>(null)
  const [settings, setSettings] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)
  const [owner, setOwner] = useState<'all' | 'mine' | string>('all')
  const [staleOnly, setStaleOnly] = useState(false)
  const [showClosed, setShowClosed] = useState(true)
  const manage = can('customers.manage')
  if ((deals.loading && !deals.data) || (stages.loading && !stages.data)) return <Spinner />
  const st = stages.data ?? []; const all = deals.data ?? []
  const ownerMatch = (d: DealRow) => owner === 'all' || (owner === 'mine' ? d.ownerId === userId : d.ownerId === owner)
  const rows = all.filter((d) => ownerMatch(d) && (!staleOnly || d.stale))
  const open = rows.filter((d) => d.stageKind === 'open')
  const weighted = open.reduce((a, d) => a + (d.value * d.probability) / 100, 0)
  const won = rows.filter((d) => d.stageKind === 'won' && d.closedAt?.slice(0, 7) === today().slice(0, 7))
  const staleCount = all.filter((d) => d.stale && ownerMatch(d)).length
  const shown = showClosed ? st : st.filter((s) => s.kind === 'open')
  const refresh = async () => { await Promise.all([deals.refresh(), stages.refresh()]) }

  async function move(d: DealRow, s: StageRow) {
    if (s.id === d.stageId) return
    if (s.kind === 'lost') return setLosing({ deal: d, stage: s })
    setError(await moveDeal(businessId, d.id, s.id)); await refresh()
  }

  if (!all.length && !(stages.data ?? []).some((s) => s.deals > 0)) {
    return (
      <>
        <GettingStarted manage={manage} onGo={onGo} onAddDeal={() => setEditing('new')} />
        {editing && <DealDialog businessId={businessId} deal={null} manage={manage} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await refresh() }} />}
      </>
    )
  }

  return (
    <>
      <div className="mb-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile title="Open pipeline" value={naira(open.reduce((a, d) => a + d.value, 0))} note={`${open.length} open ${open.length === 1 ? 'deal' : 'deals'}`} />
        <Tile title="Likely to close" value={naira(weighted)} note="Value times each stage's chance of winning" />
        <Tile title="Won this month" value={naira(won.reduce((a, d) => a + d.value, 0))} note={`${won.length} ${won.length === 1 ? 'deal' : 'deals'}`} />
        <button type="button" onClick={() => setStaleOnly((s) => !s)} className={clsx('rounded-lg border bg-white p-3 text-left transition hover:bg-surface', staleOnly ? 'border-amber' : 'border-line')} aria-pressed={staleOnly}>
          <p className="text-xs uppercase tracking-wide text-ink/60">Gone quiet</p><p className={clsx('mt-0.5 text-xl font-bold', staleCount ? 'text-warning' : '')}>{staleCount}</p>
          <p className="text-xs text-ink/60">{staleOnly ? 'Showing only these. Tap to show all' : 'No activity for 14+ days. Tap to filter'}</p>
        </button>
      </div>
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <div className="w-48"><SelectField label="Owner" value={owner} onChange={(e) => setOwner(e.target.value)}><option value="all">Everyone</option><option value="mine">My deals</option>{(team.data ?? []).map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}</SelectField></div>
        <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} /> Show won and lost</label>
        <div className="ml-auto flex gap-2">{manage && <Button variant="secondary" onClick={() => setSettings(true)}>Pipeline stages</Button>}{manage && <Button onClick={() => setEditing('new')}>Add deal</Button>}</div>
      </div>
      {(error || deals.error) && <ErrorState message={error ?? deals.error!} />}
      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-[repeat(var(--cols),minmax(0,1fr))]" style={{ '--cols': shown.length } as CSSProperties}>
        {shown.map((s) => {
          const list = rows.filter((d) => d.stageId === s.id); const i = st.indexOf(s)
          return (
            <section key={s.id} aria-label={`${s.name} deals`} className="min-w-0 rounded-lg border border-line bg-surface/60 p-2"
              onDragOver={(e) => { if (manage) e.preventDefault() }}
              onDrop={() => { const d = all.find((x) => x.id === dragging); setDragging(null); if (d && manage) void move(d, s) }}>
              <header className="mb-2 border-b-2 px-1 pb-1" style={{ borderColor: colorOf(s, i) }}>
                <div className="flex items-baseline justify-between gap-2"><h3 className="truncate text-xs font-bold uppercase tracking-wide" style={{ color: colorOf(s, i) }}>{s.name}</h3><span className="text-[11px] text-ink/60">{list.length}</span></div>
                <p className="text-[11px] text-ink/60">{naira(list.reduce((a, d) => a + d.value, 0))}{s.kind === 'open' ? ` · ${s.probability}%` : ''}</p>
              </header>
              <ul className="space-y-2">
                {list.map((d) => <DealCard key={d.id} d={d} stages={st} manage={manage} onOpen={() => setEditing(d)} onMove={(stage) => void move(d, stage)} onDrag={(on) => setDragging(on ? d.id : null)} />)}
                {list.length === 0 && <li className="px-1 py-3 text-center text-xs text-ink/45">Nothing here</li>}
              </ul>
            </section>
          )
        })}
      </div>
      {editing && <DealDialog businessId={businessId} deal={editing === 'new' ? null : editing} manage={manage} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await refresh() }} />}
      {losing && <LostDialog businessId={businessId} deal={losing.deal} stage={losing.stage} onClose={() => setLosing(null)} onDone={async () => { setLosing(null); await refresh() }} />}
      {settings && <StageSettings businessId={businessId} onClose={() => setSettings(false)} onChanged={refresh} />}
    </>
  )
}

const Tile = ({ title, value, note }: { title: string; value: string; note: string }) => (
  <div className="rounded-lg border border-line bg-white p-3"><p className="text-xs uppercase tracking-wide text-ink/60">{title}</p><p className="mt-0.5 text-xl font-bold">{value}</p><p className="text-xs text-ink/60">{note}</p></div>
)

function DealCard({ d, stages, manage, onOpen, onMove, onDrag }: { d: DealRow; stages: StageRow[]; manage: boolean; onOpen: () => void; onMove: (s: StageRow) => void; onDrag: (on: boolean) => void }) {
  const late = !!d.expectedClose && d.expectedClose < today() && d.stageKind === 'open'
  return (
    <li draggable={manage} onDragStart={() => onDrag(true)} onDragEnd={() => onDrag(false)} className={clsx('rounded-md border bg-white p-2 text-sm shadow-card', d.stale ? 'border-amber/70' : 'border-line')}>
      <button className="block w-full text-left" onClick={onOpen}>
        <b className="block break-words">{d.title}</b>
        <span className="block text-xs text-ink/60">{d.contact || '–'}</span>
        <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs"><b>{naira(d.value)}</b>{d.stageKind === 'open' && <span className="text-ink/60">{d.probability}%</span>}{d.expectedClose && <Badge tone={late ? 'danger' : 'neutral'}>{late ? 'Late · ' : 'By '}{d.expectedClose}</Badge>}{d.stale && <Badge tone="warning">Gone quiet</Badge>}</span>
        {d.nextStep && <span className="mt-1 block text-xs text-ink/70">Next: {d.nextStep}</span>}
        {d.stageKind === 'lost' && d.lostReason && <span className="mt-1 block text-xs text-ink/60">Lost: {d.lostReason}</span>}
      </button>
      <div className="mt-2 flex items-center justify-between gap-2">
        <ContactActions name={d.contact} phone={d.contactPhone} email={d.contactEmail} />
        {d.ownerName && <span title={d.ownerName} className="grid size-6 place-items-center rounded-full bg-brand/15 text-[10px] font-bold text-brand-ink">{initials(d.ownerName)}</span>}
      </div>
      {manage && (
        <select aria-label={`Move ${d.title} to`} value={d.stageId} onChange={(e) => { const s = stages.find((x) => x.id === e.target.value); if (s) onMove(s) }} className="mt-2 w-full rounded border border-line bg-white px-1.5 py-1 text-xs">
          {stages.map((s) => <option key={s.id} value={s.id}>{s.id === d.stageId ? s.name : `Move to ${s.name}`}</option>)}
        </select>
      )}
    </li>
  )
}

export function GettingStarted({ manage, onGo, onAddDeal }: { manage: boolean; onGo: (tab: 'Customers' | 'Leads' | 'Activities' | 'Quotes') => void; onAddDeal: () => void }) {
  const steps: { n: number; title: string; text: string; action: string; run: () => void }[] = [
    { n: 1, title: 'Bring in your contacts', text: 'Upload a spreadsheet (CSV) of customers, or add them one by one. Duplicates are skipped for you.', action: 'Add or import customers', run: () => onGo('Customers') },
    { n: 2, title: 'Capture your leads', text: 'People who have shown interest but have not bought yet. Rate them hot, warm or cold.', action: 'Add leads', run: () => onGo('Leads') },
    { n: 3, title: 'Create a deal', text: 'A deal is a possible sale with a value and a date. Move it along the pipeline as it progresses.', action: 'Add your first deal', run: onAddDeal },
    { n: 4, title: 'Plan your follow-ups', text: 'Schedule calls, meetings and tasks so nothing slips. What is due shows up first.', action: 'Open activities', run: () => onGo('Activities') },
  ]
  return (
    <Card>
      <h2 className="text-lg font-semibold">Get your CRM going</h2>
      <p className="mt-1 text-sm text-ink/70">Four steps, in any order. Your pipeline fills in as you go: the board shows each deal by stage, what is likely to close, and which ones have gone quiet.</p>
      <ol className="mt-4 grid gap-3 sm:grid-cols-2">
        {steps.map((s) => (
          <li key={s.n} className="flex gap-3 rounded-lg border border-line p-3">
            <span className="grid size-7 shrink-0 place-items-center rounded-full bg-amber text-sm font-bold text-ink">{s.n}</span>
            <div className="min-w-0"><p className="font-semibold">{s.title}</p><p className="mt-0.5 text-sm text-ink/70">{s.text}</p>{manage && <Button variant="secondary" className="mt-2" onClick={s.run}>{s.action}</Button>}</div>
          </li>
        ))}
      </ol>
    </Card>
  )
}

function LostDialog({ businessId, deal, stage, onClose, onDone }: { businessId: string; deal: DealRow; stage: StageRow; onClose: () => void; onDone: () => Promise<void> }) {
  const [reason, setReason] = useState('')
  const runner = useFormRunner(onDone)
  return (
    <Dialog title={`Mark "${deal.title}" as lost`} onClose={onClose}>
      <div className="space-y-3 text-sm">
        <TextField label="Why was it lost?" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Price too high, chose a competitor, no response…" />
        {runner.error && <ErrorState title="Not saved" message={runner.error} />}
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={runner.busy} onClick={() => void runner.run(async () => moveDeal(businessId, deal.id, stage.id, reason), 'Saved.')}>Mark as lost</Button></div>
      </div>
    </Dialog>
  )
}

/** Your own stages: rename them, set the chance of winning at each, reorder, add and remove. Won and Lost are always last and cannot be removed. */
function StageSettings({ businessId, onClose, onChanged }: { businessId: string; onClose: () => void; onChanged: () => Promise<void> }) {
  const stages = useAsync(() => listStages(businessId), [businessId])
  const [error, setError] = useState<string | null>(null)
  const [newName, setNewName] = useState(''); const [newProb, setNewProb] = useState('50')
  const [drafts, setDrafts] = useState<Record<string, { name: string; probability: string }>>({})
  const list = stages.data ?? []; const open = list.filter((s) => s.kind === 'open')
  const done = async () => { await Promise.all([stages.refresh(), onChanged()]) }
  const draft = (s: StageRow) => drafts[s.id] ?? { name: s.name, probability: String(s.probability) }
  const set = (s: StageRow, k: 'name' | 'probability', v: string) => setDrafts((d) => ({ ...d, [s.id]: { ...draft(s), [k]: v } }))
  const save = async (s: StageRow) => { const d = draft(s); setError(await saveStage(businessId, { id: s.id, name: d.name, probability: Number(d.probability) })); setDrafts((x) => { const { [s.id]: _gone, ...rest } = x; void _gone; return rest }); await done() }
  const shift = async (i: number, by: -1 | 1) => { const ids = open.map((s) => s.id); const j = i + by; if (j < 0 || j >= ids.length) return; [ids[i], ids[j]] = [ids[j], ids[i]]; setError(await reorderStages(businessId, ids)); await done() }
  return (
    <Dialog title="Pipeline stages" onClose={onClose} wide>
      <div className="space-y-3 text-sm">
        <p className="text-ink/70">Name the steps a sale goes through and say how likely a deal is to be won at each. The board uses these chances to show what is likely to close.</p>
        {error && <ErrorState title="Not changed" message={error} />}
        <ul className="space-y-2">
          {list.map((s) => {
            const d = draft(s); const dirty = d.name !== s.name || d.probability !== String(s.probability); const i = open.indexOf(s)
            return (
              <li key={s.id} className="grid grid-cols-[1fr_5.5rem_auto] items-center gap-2 max-sm:grid-cols-2">
                <input aria-label={`Name of ${s.name}`} value={d.name} onChange={(e) => set(s, 'name', e.target.value)} className="rounded-md border border-line px-2 py-1.5" />
                {s.kind === 'open' ? <input aria-label={`Chance of winning at ${s.name}`} type="number" min={0} max={100} value={d.probability} onChange={(e) => set(s, 'probability', e.target.value)} className="rounded-md border border-line px-2 py-1.5" /> : <span className="text-center text-ink/60">{s.kind === 'won' ? '100%' : '0%'}</span>}
                <span className="flex items-center gap-1 max-sm:col-span-2">
                  {s.kind === 'open' && <><button type="button" aria-label={`Move ${s.name} up`} disabled={i === 0} onClick={() => void shift(i, -1)} className="p-1.5 text-ink/60 hover:text-ink disabled:opacity-30"><ArrowUp className="size-4" aria-hidden /></button>
                    <button type="button" aria-label={`Move ${s.name} down`} disabled={i === open.length - 1} onClick={() => void shift(i, 1)} className="p-1.5 text-ink/60 hover:text-ink disabled:opacity-30"><ArrowDown className="size-4" aria-hidden /></button></>}
                  {dirty && <Button variant="secondary" onClick={() => void save(s)}>Save</Button>}
                  {s.kind === 'open' && <button type="button" aria-label={`Remove ${s.name}`} title={s.deals ? 'Move its deals out first' : 'Remove this stage'} disabled={s.deals > 0 || open.length <= 1} onClick={async () => { setError(await deleteStage(businessId, s.id)); await done() }} className="p-1.5 text-ink/50 hover:text-danger disabled:opacity-30"><Trash2 className="size-4" aria-hidden /></button>}
                  {s.kind !== 'open' && <Badge>{s.kind === 'won' ? 'Closed as won' : 'Closed as lost'}</Badge>}
                  {s.deals > 0 && <span className="text-xs text-ink/50">{s.deals} {s.deals === 1 ? 'deal' : 'deals'}</span>}
                </span>
              </li>
            )
          })}
        </ul>
        <div className="grid grid-cols-[1fr_5.5rem_auto] items-end gap-2 border-t border-line pt-3 max-sm:grid-cols-2">
          <TextField label="New stage" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Site visit" />
          <TextField label="Chance %" type="number" min={0} max={100} value={newProb} onChange={(e) => setNewProb(e.target.value)} />
          <Button onClick={async () => { const e = await saveStage(businessId, { id: null, name: newName, probability: Number(newProb) }); setError(e); if (!e) { setNewName(''); await done() } }}>Add stage</Button>
        </div>
        <div className="flex justify-end"><Button variant="secondary" onClick={onClose}>Done</Button></div>
      </div>
    </Dialog>
  )
}

function DealDialog({ businessId, deal, manage, onClose, onSaved }: { businessId: string; deal: DealRow | null; manage: boolean; onClose: () => void; onSaved: () => Promise<void> }) {
  const { userId } = useAuth()
  const contacts = useAsync(() => listContacts(businessId), [businessId])
  const team = useAsync(() => listTeam(businessId), [businessId])
  const history = useAsync(() => (deal ? dealEvents(businessId, deal.id) : Promise.resolve([])), [businessId, deal?.id])
  const timeline = useAsync(() => (deal ? dealInteractions(businessId, deal.id) : Promise.resolve([])), [businessId, deal?.id])
  const open = useAsync(async () => (deal ? (await listActivities(businessId)).filter((a) => a.dealId === deal.id && a.status === 'open') : []), [businessId, deal?.id])
  const [title, setTitle] = useState(deal?.title ?? '')
  const [contact, setContact] = useState(deal ? (deal.customerId ? `customer:${deal.customerId}` : `lead:${deal.leadId}`) : '')
  const [value, setValue] = useState(deal ? String(deal.value) : '')
  const [expected, setExpected] = useState(deal?.expectedClose ?? '')
  const [ownerId, setOwnerId] = useState(deal?.ownerId ?? userId ?? '')
  const [notes, setNotes] = useState(deal?.notes ?? '')
  const [step, setStep] = useState(deal?.nextStep ?? '')
  const runner = useFormRunner(onSaved)
  const pick = (c: Contact) => `${c.kind}:${c.id}`
  const [kind, id] = contact.split(':')
  const list = contacts.data ?? []
  const known = list.some((c) => pick(c) === contact)
  return (
    <Dialog title={deal ? 'Deal' : 'Add deal'} onClose={onClose} wide>
      <div className="space-y-3 text-sm">
        <TextField label="What is the deal for?" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Weekly supply, website redesign, party order…" disabled={!manage} />
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField label="With" value={contact} onChange={(e) => setContact(e.target.value)} disabled={!manage}>
            <option value="">Choose a customer or lead</option>
            {deal && !known && contact && <option value={contact}>{deal.contact || 'Current contact'}</option>}
            {list.some((c) => c.kind === 'customer') && <optgroup label="Customers">{list.filter((c) => c.kind === 'customer').map((c) => <option key={pick(c)} value={pick(c)}>{c.name}</option>)}</optgroup>}
            {list.some((c) => c.kind === 'lead') && <optgroup label="Leads">{list.filter((c) => c.kind === 'lead').map((c) => <option key={pick(c)} value={pick(c)}>{c.name}</option>)}</optgroup>}
          </SelectField>
          <SelectField label="Owner" value={ownerId} onChange={(e) => setOwnerId(e.target.value)} disabled={!manage}><option value="">Nobody yet</option>{(team.data ?? []).map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}</SelectField>
          <TextField label="Value (₦)" type="number" min={0} value={value} onChange={(e) => setValue(e.target.value)} disabled={!manage} />
          <TextField label="Expected close date" type="date" value={expected} onChange={(e) => setExpected(e.target.value)} disabled={!manage} />
        </div>
        <TextField label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} disabled={!manage} />
        {deal && <p className="text-xs text-ink/60">Stage: <b>{deal.stageName}</b>{deal.stageKind === 'open' ? ` · ${deal.probability}% chance of winning` : ''}{deal.stageKind === 'lost' && deal.lostReason ? ` · lost because: ${deal.lostReason}` : ''}</p>}
        {runner.error && <ErrorState title="Not saved" message={runner.error} />}
        {manage && <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Close</Button>
          <Button loading={runner.busy} onClick={() => void runner.run(async () => saveDeal(businessId, { id: deal?.id ?? null, title, customerId: kind === 'customer' ? id : null, leadId: kind === 'lead' ? id : null, value: Number(value || 0), expectedClose: expected || null, ownerId: ownerId || null, notes }), 'Saved.')}>{deal ? 'Save deal' : 'Add deal'}</Button></div>}
        {deal && (
          <div className="space-y-3 border-t border-line pt-3">
            <div className="flex items-end gap-2"><div className="flex-1"><TextField label="Next step" value={step} onChange={(e) => setStep(e.target.value)} placeholder="e.g. Send the proposal on Friday" disabled={!manage} /></div>
              {manage && step !== deal.nextStep && <Button variant="secondary" onClick={async () => { await setNextStep(businessId, deal.id, step); await onSaved() }}>Save</Button>}</div>
            {manage && <DealActivityForms businessId={businessId} dealId={deal.id} team={team.data ?? []} onDone={async () => { await Promise.all([timeline.refresh(), open.refresh()]) }} />}
            {(open.data?.length ?? 0) > 0 && <div><h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink/60">Coming up</h4><ul className="space-y-0.5 text-xs">{open.data!.map((a) => <li key={a.id}><Badge>{label(a.kind)}</Badge> {a.title}{a.dueAt ? ` · ${dateTime(a.dueAt)}` : ''}</li>)}</ul></div>}
            {(timeline.data?.length ?? 0) > 0 && <div><h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink/60">Activity</h4><ul className="space-y-0.5 text-xs">{timeline.data!.map((t, i) => <li key={i}><Badge>{label(t.kind)}</Badge> {t.summary} <span className="text-ink/50">· {dateTime(t.at)}</span></li>)}</ul></div>}
            {(history.data?.length ?? 0) > 0 && <div><h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink/60">Stage history</h4><ul className="space-y-0.5 text-xs">{history.data!.map((h, i) => <li key={i}>{dateTime(h.at)}: {h.from ? `${h.from} → ${h.to}` : `Created in ${h.to}`}{h.note ? ` (${h.note})` : ''}</li>)}</ul></div>}
          </div>
        )}
      </div>
    </Dialog>
  )
}

/** Log what happened on a deal, or schedule what comes next. */
function DealActivityForms({ businessId, dealId, team, onDone }: { businessId: string; dealId: string; team: { userId: string; name: string }[]; onDone: () => Promise<void> }) {
  const { userId } = useAuth()
  const [logKind, setLogKind] = useState('call'); const [summary, setSummary] = useState('')
  const [kind, setKind] = useState<ActivityKind>('call'); const [what, setWhat] = useState(''); const [due, setDue] = useState(''); const [who, setWho] = useState(userId ?? '')
  const [error, setError] = useState<string | null>(null)
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-2">
        <h4 className="font-semibold">Log what happened</h4>
        <SelectField label="Type" value={logKind} onChange={(e) => setLogKind(e.target.value)}><option value="call">Call</option><option value="meeting">Meeting</option><option value="email">Email</option><option value="message">Message</option><option value="note">Note</option></SelectField>
        <TextField label="Summary" value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="What was said or agreed" />
        <Button variant="secondary" onClick={async () => { const e = await logOnDeal(businessId, dealId, logKind, summary); setError(e); if (!e) { setSummary(''); await onDone() } }}>Add to timeline</Button>
      </div>
      <div className="space-y-2">
        <h4 className="font-semibold">Schedule next</h4>
        <SelectField label="Type" value={kind} onChange={(e) => setKind(e.target.value as ActivityKind)}>{ACTIVITY_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}</SelectField>
        <TextField label="What" value={what} onChange={(e) => setWhat(e.target.value)} placeholder="Call to confirm the order" />
        <div className="grid grid-cols-2 gap-2"><TextField label="When" type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} /><SelectField label="For" value={who} onChange={(e) => setWho(e.target.value)}><option value="">Nobody</option>{team.map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}</SelectField></div>
        <Button variant="secondary" onClick={async () => { const e = await createActivity(businessId, { dealId }, { kind, title: what, dueAt: due ? new Date(due).toISOString() : null, assignedTo: who || null }); setError(e); if (!e) { setWhat(''); setDue(''); await onDone() } }}>Schedule</Button>
      </div>
      {error && <div className="sm:col-span-2"><ErrorState title="Not saved" message={error} /></div>}
    </div>
  )
}
