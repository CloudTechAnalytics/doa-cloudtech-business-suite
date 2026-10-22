import { Plus } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { useBusiness } from '@/core/business-context/BusinessProvider'
import { usePermissions } from '@/core/permissions/usePermissions'
import { Badge, Button, Card, EmptyState, ErrorState, Notice, PageHeader, SelectField, Spinner, TextField } from '@/shared/components'
import { Dialog } from '@/shared/components/dialog'
import { DetailPage } from '@/shared/components/detail-page'
import { useAsync } from '@/shared/hooks/useAsync'
import { useFormRunner } from '@/shared/hooks/useFormRunner'
import { naira } from '@/shared/utilities/format'
import { cashMovement, closeShift, loadCashMoves, loadShifts, openShift, reviewShift } from '../services/martApi'
import type { ShiftSummary } from '../services/martApi'

const TONE = { open: 'warning', closed: 'info', reviewed: 'success' } as const

/** Cashier shifts: opening cash, cash in and out, and the count at close. Expected cash is worked out from the cashier's own cash sales. */
export function RetailShiftsPage() {
  const { active } = useBusiness()
  const businessId = active?.id ?? ''
  const shifts = useAsync(() => loadShifts(businessId), [businessId])
  const { can } = usePermissions(businessId)
  const [opening, setOpening] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  if (!active) return null
  const sell = can('sales.create'); const manage = can('retail.manage')
  const current = shifts.data?.find((s) => s.id === openId) ?? null
  const hasOpen = shifts.data?.some((s) => s.status === 'open') ?? false

  return (
    <>
      <PageHeader title="Cashier shifts" description="Open a shift with the cash in the drawer, and close it with a count. The difference between counted and expected cash is kept for the manager to review."
        actions={sell ? <Button onClick={() => setOpening(true)}><Plus className="size-4" aria-hidden /> Open shift</Button> : undefined} />
      {shifts.error && <ErrorState message={shifts.error} />}
      {shifts.loading ? <Spinner /> : !shifts.data?.length ? <Card><EmptyState title="No shifts yet" description="Cashiers see their own shifts. Managers see everyone's." /></Card> : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-surface text-left text-xs font-semibold text-ink/70"><tr><th className="p-3">Shift</th><th className="p-3">Cashier</th><th className="p-3 text-right">Opening</th><th className="p-3 text-right">Cash expected</th><th className="p-3 text-right">Counted</th><th className="p-3 text-right">Difference</th><th className="p-3">Status</th><th className="p-3" /></tr></thead>
            <tbody className="divide-y divide-ink/10">
              {shifts.data.map((s) => (
                <tr key={s.id}>
                  <td className="p-3 font-medium">{s.number}<div className="text-xs font-normal text-ink/60">{s.openedAt.slice(0, 16).replace('T', ' ')}</div></td>
                  <td className="p-3">{s.cashierName}</td>
                  <td className="tabular p-3 text-right">{naira(s.openingCash)}</td>
                  <td className="tabular p-3 text-right">{naira(s.expectedCash)}</td>
                  <td className="tabular p-3 text-right">{s.counted === null ? '–' : naira(s.counted)}</td>
                  <td className={`tabular p-3 text-right ${s.variance === null ? '' : s.variance < 0 ? 'text-danger' : s.variance > 0 ? 'text-warning' : ''}`}>{s.variance === null ? '–' : naira(s.variance)}</td>
                  <td className="p-3"><Badge tone={TONE[s.status]}>{s.status === 'open' ? 'Open' : s.status === 'closed' ? 'Closed' : 'Reviewed'}</Badge></td>
                  <td className="p-3 text-right"><Button variant="secondary" onClick={() => setOpenId(s.id)}>Details</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      {opening && <OpenDialog businessId={businessId} blocked={hasOpen} onClose={() => setOpening(false)} onSaved={async () => { setOpening(false); await shifts.refresh() }} />}
      {current && <ShiftDialog businessId={businessId} shift={current} manage={manage} onClose={() => setOpenId(null)} onChanged={shifts.refresh} />}
    </>
  )
}

function OpenDialog({ businessId, blocked, onClose, onSaved }: { businessId: string; blocked: boolean; onClose: () => void; onSaved: () => Promise<void> }) {
  const runner = useFormRunner(onSaved)
  const [error, setError] = useState<string | null>(null)
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const v = String(new FormData(e.currentTarget).get('cash') ?? '').trim()
    if (v === '' || !(Number(v) >= 0)) return setError('Enter the cash in the drawer (0 or more).')
    setError(null)
    await runner.run((k) => openShift(businessId, Number(v), k), 'Shift opened.')
  }
  return (
    <Dialog title="Open a shift" onClose={onClose}>
      <form onSubmit={submit} noValidate className="space-y-4">
        {blocked && <Notice>A cashier can have only one open shift. If it is yours, close it first.</Notice>}
        <TextField label="Opening cash" name="cash" type="number" min="0" step="0.01" error={error ?? undefined} autoFocus hint="Count the notes and coins in the drawer." />
        {runner.error && <ErrorState title="Not opened" message={runner.error} />}
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={runner.busy}>Open shift</Button></div>
      </form>
    </Dialog>
  )
}

function ShiftDialog({ businessId, shift, manage, onClose, onChanged }: { businessId: string; shift: ShiftSummary; manage: boolean; onClose: () => void; onChanged: () => Promise<void> }) {
  const moves = useAsync(() => loadCashMoves(businessId, shift.id), [businessId, shift.id])
  const runner = useFormRunner(async () => { await Promise.all([onChanged(), moves.refresh()]) })
  const [problem, setProblem] = useState<string | null>(null)
  const [counted, setCounted] = useState(''); const [notes, setNotes] = useState('')
  const [dir, setDir] = useState<'in' | 'out'>('out'); const [amount, setAmount] = useState(''); const [why, setWhy] = useState('')
  const [review, setReview] = useState('')
  const isOpen = shift.status === 'open'
  const projected = counted === '' ? null : Math.round((Number(counted) - shift.expectedCash) * 100) / 100
  const needsNote = shift.variance !== null && shift.variance !== 0

  function addMove(e: FormEvent) {
    e.preventDefault()
    if (!(Number(amount) > 0)) return setProblem('Enter an amount above zero.')
    if (why.trim().length < 3) return setProblem('Say what the cash was for.')
    setProblem(null)
    void runner.run((k) => cashMovement(businessId, shift.id, dir, Number(amount), why, k), 'Recorded.').then(() => { setAmount(''); setWhy('') })
  }
  return (
    <DetailPage title={`Shift ${shift.number}`} onClose={onClose} wide>
      <div className="space-y-4 text-sm">
        <dl className="grid gap-2 sm:grid-cols-3">
          {[['Opening cash', shift.openingCash], ['Cash sales', shift.cashSales], ['Cash refunds', -shift.cashRefunds], ['Cash in', shift.movedIn], ['Cash out', -shift.movedOut]].map(([l, v]) => <div key={String(l)} className="rounded-md bg-surface p-2"><dt className="text-xs text-ink/60">{l}</dt><dd className="tabular font-semibold">{naira(Number(v))}</dd></div>)}
          <div className="rounded-md bg-amber/20 p-2"><dt className="text-xs text-ink/70">Cash expected in the drawer</dt><dd className="tabular font-semibold">{naira(shift.expectedCash)}</dd></div>
        </dl>
        {shift.otherMethods > 0 && <p className="text-xs text-ink/60">Card, transfer and other payments this shift: {naira(shift.otherMethods)}. These are not cash and are not counted in the drawer.</p>}
        <div>
          <h3 className="mb-1 font-semibold">Cash in and out</h3>
          {moves.data?.length ? <ul className="mb-2 divide-y divide-ink/10">{moves.data.map((m) => <li key={m.id} className="flex justify-between py-1"><span>{m.reason}</span><span className="tabular">{m.direction === 'in' ? '+' : '-'}{naira(m.amount)}</span></li>)}</ul> : <p className="mb-2 text-ink/60">None yet.</p>}
          {isOpen && (
            <form onSubmit={addMove} className="grid items-end gap-2 sm:grid-cols-[110px_130px_1fr_auto]">
              <SelectField label="Type" value={dir} onChange={(e) => setDir(e.target.value as 'in' | 'out')}><option value="out">Cash out</option><option value="in">Cash in</option></SelectField>
              <TextField label="Amount" type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
              <TextField label="Reason" value={why} onChange={(e) => setWhy(e.target.value)} placeholder="Change float, bank drop, errand" />
              <Button type="submit" variant="secondary" loading={runner.busy}>Add</Button>
            </form>
          )}
        </div>
        {isOpen && (
          <div className="rounded-md border border-line p-3">
            <h3 className="mb-2 font-semibold">Close shift</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField label="Cash counted in the drawer" type="number" min="0" step="0.01" value={counted} onChange={(e) => setCounted(e.target.value)} />
              <TextField label="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            {projected !== null && <p className={`mt-2 ${projected === 0 ? 'text-success' : 'text-warning'}`}>{projected === 0 ? 'The count matches.' : `${projected < 0 ? 'Short' : 'Over'} by ${naira(Math.abs(projected))}.`}</p>}
            <div className="mt-3 flex justify-end"><Button disabled={counted === '' || !(Number(counted) >= 0)} loading={runner.busy} onClick={() => void runner.run((k) => closeShift(businessId, shift.id, Number(counted), notes, k), 'Shift closed.')}>Close shift</Button></div>
          </div>
        )}
        {shift.status !== 'open' && <p>Counted <b className="tabular">{naira(shift.counted ?? 0)}</b>, expected <b className="tabular">{naira(shift.expectedCash)}</b>, difference <b className="tabular">{naira(shift.variance ?? 0)}</b>.{shift.notes ? ` Cashier note: ${shift.notes}` : ''}</p>}
        {shift.status === 'reviewed' && <Notice>Reviewed{shift.reviewNote ? `: ${shift.reviewNote}` : '.'}</Notice>}
        {shift.status === 'closed' && manage && (
          <div className="rounded-md border border-line p-3">
            <h3 className="mb-2 font-semibold">Manager review</h3>
            <TextField label={needsNote ? 'Review note (required: the count did not match)' : 'Review note (optional)'} value={review} onChange={(e) => setReview(e.target.value)} />
            <div className="mt-3 flex justify-end"><Button disabled={needsNote && review.trim().length < 3} loading={runner.busy} onClick={() => void runner.run(async () => reviewShift(businessId, shift.id, review), 'Reviewed.')}>Mark reviewed</Button></div>
          </div>
        )}
        {(problem || runner.error) && <ErrorState title="Not saved" message={(problem ?? runner.error)!} />}
        <div className="flex justify-end"><Button variant="secondary" onClick={onClose}>Close</Button></div>
      </div>
    </DetailPage>
  )
}
