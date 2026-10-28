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
import { cashMovement, closeShift, deleteShift, loadCashMoves, loadShifts, openShift, reviewShift } from '../services/martApi'
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
      <PageHeader title="Cashier shifts" description="A shift is one cashier's turn at the till. Open it with the cash already in the drawer, sell, and close it by counting the drawer. The system works out what should be there; any difference is kept for the manager to review."
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
  // Only a shift that is still open and where nothing has happened (no sales of any kind, no refunds, no cash in or out) was opened by mistake and can be deleted.
  const idle = isOpen && shift.cashSales === 0 && shift.cashRefunds === 0 && shift.movedIn === 0 && shift.movedOut === 0 && shift.otherMethods === 0

  function addMove(e: FormEvent) {
    e.preventDefault()
    if (!(Number(amount) > 0)) return setProblem('Enter an amount above zero.')
    if (why.trim().length < 3) return setProblem('Say what the cash was for.')
    if (dir === 'out' && Number(amount) > shift.expectedCash) return setProblem(`There is only ${naira(shift.expectedCash)} in the drawer, so ${naira(Number(amount))} cannot be taken out. Take out no more than what is there.`)
    setProblem(null)
    void runner.run((k) => cashMovement(businessId, shift.id, dir, Number(amount), why, k), 'Recorded.').then(() => { setAmount(''); setWhy('') })
  }
  return (
    <DetailPage title={`Shift ${shift.number}`} onClose={onClose} wide actions={manage && idle ? <DeleteShift businessId={businessId} shift={shift} onDeleted={async () => { onClose(); await onChanged() }} /> : undefined}>
      <div className="space-y-4 text-sm">
        <dl className="grid gap-2 sm:grid-cols-3">
          {[['Opening cash', shift.openingCash], ['Cash sales', shift.cashSales], ['Cash refunds', -shift.cashRefunds], ['Cash in', shift.movedIn], ['Cash out', -shift.movedOut]].map(([l, v]) => <div key={String(l)} className="rounded-md bg-surface p-2"><dt className="text-xs text-ink/60">{l}</dt><dd className="tabular font-semibold">{naira(Number(v))}</dd></div>)}
          <div className="rounded-md bg-amber/20 p-2"><dt className="text-xs text-ink/70">Cash expected in the drawer</dt><dd className="tabular font-semibold">{naira(shift.expectedCash)}</dd></div>
        </dl>
        <details className="rounded-md border border-line bg-surface/60 p-3 text-xs text-ink/80">
          <summary className="cursor-pointer text-sm font-semibold text-ink">How the cash is worked out</summary>
          <div className="mt-2 space-y-2">
            <p><b>Cash expected in the drawer</b> = opening cash + cash sales − cash refunds + cash in − cash out.</p>
            <p><b>Cash sales</b> are only what customers paid in cash for the things they bought. The change handed back is never counted, and card, transfer and POS payments are not cash, so they are left out.</p>
            <p><b>Cash in</b> is money you put into the drawer that is not a sale: for example change brought from the safe, or the owner topping up the float. <b>Cash out</b> is money you take from the drawer that is not a refund: for example a bank drop, paying a delivery person, or an errand. Each needs a reason, and both appear in this shift's record.</p>
            <p><b>Cash out cannot be more than what is in the drawer.</b> If the drawer should hold {naira(shift.expectedCash)}, you can take out at most {naira(shift.expectedCash)}. This stops the expected cash from going below zero and a short drawer from being hidden by a large payout.</p>
            <p><b>Closing:</b> count the real cash and type it in. The difference between what you counted and what was expected is recorded; a manager must write a note if it does not match. A shift cannot be edited after it is closed.</p>
            <p><b>Deleting:</b> only a manager or the owner can delete a shift, and only one that is still open with nothing in it (opened by mistake: no sales of any kind, no refunds, no cash in or out). Once there is a sale or any cash movement, or the shift is closed, it is a money record: it is kept, closed and reviewed, never deleted.</p>
          </div>
        </details>
        {shift.otherMethods > 0 && <p className="text-xs text-ink/60">Card, transfer and other payments this shift: {naira(shift.otherMethods)}. These are not cash and are not counted in the drawer.</p>}
        <div>
          <h3 className="mb-1 font-semibold">Cash in and out</h3>
          {moves.data?.length ? <ul className="mb-2 divide-y divide-ink/10">{moves.data.map((m) => <li key={m.id} className="flex justify-between py-1"><span>{m.reason}</span><span className="tabular">{m.direction === 'in' ? '+' : '-'}{naira(m.amount)}</span></li>)}</ul> : <p className="mb-2 text-ink/60">None yet.</p>}
          {isOpen && <p className="mb-1 text-xs text-ink/60">In the drawer now: <b className="tabular">{naira(shift.expectedCash)}</b>. Cash out can be at most this.</p>}
          {isOpen && (
            <form onSubmit={addMove} className="grid items-end gap-2 sm:grid-cols-[110px_130px_1fr_auto]">
              <SelectField label="Type" value={dir} onChange={(e) => setDir(e.target.value as 'in' | 'out')}><option value="out">Take cash OUT</option><option value="in">Put cash IN</option></SelectField>
              <TextField label="Amount" type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
              <TextField label="Reason" value={why} onChange={(e) => setWhy(e.target.value)} placeholder={dir === 'out' ? 'Bank drop, errand, supplier' : 'Float from the safe, top-up'} />
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

/** A manager's way to remove a shift that was opened by mistake. The reason is kept in the audit trail. */
function DeleteShift({ businessId, shift, onDeleted }: { businessId: string; shift: ShiftSummary; onDeleted: () => Promise<void> }) {
  const [asking, setAsking] = useState(false); const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null)
  async function confirm() {
    if (reason.trim().length < 3) return setError('Say why, in a few words.')
    setBusy(true); setError(null); const err = await deleteShift(businessId, shift.id, reason); setBusy(false)
    if (err) return setError(err)
    setAsking(false); await onDeleted()
  }
  return (
    <>
      <Button variant="secondary" onClick={() => { setError(null); setAsking(true) }}>Delete shift</Button>
      {asking && (
        <Dialog title={`Delete shift ${shift.number}?`} onClose={() => setAsking(false)}>
          <div className="space-y-3 text-sm">
            <p>This shift is still open and nothing has happened in it, so it can be removed. This cannot be undone; the reason is kept in the audit trail.</p>
            <TextField label="Why is it being deleted?" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Opened by mistake" autoFocus />
            {error && <ErrorState title="Not deleted" message={error} />}
            <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setAsking(false)}>Cancel</Button><Button loading={busy} onClick={() => void confirm()} className="bg-danger text-white hover:bg-danger/90">Delete</Button></div>
          </div>
        </Dialog>
      )}
    </>
  )
}
