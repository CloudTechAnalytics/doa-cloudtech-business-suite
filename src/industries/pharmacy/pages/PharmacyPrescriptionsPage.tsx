import { Plus, X } from 'lucide-react'
import { useState } from 'react'
import { useBusiness } from '@/core/business-context/BusinessProvider'
import { usePermissions } from '@/core/permissions/usePermissions'
import { listCustomers, loadCatalog } from '@/modules/sales/tradeApi'
import { Badge, Button, Card, EmptyState, ErrorState, Notice, PageHeader, SelectField, Spinner, TextField } from '@/shared/components'
import { Dialog } from '@/shared/components/dialog'
import { useAsync } from '@/shared/hooks/useAsync'
import { useFormRunner } from '@/shared/hooks/useFormRunner'
import { label, naira, qty } from '@/shared/utilities/format'
import { CLASS_LABEL, cancelPrescription, dispense, loadMedicines, loadPrescriptions, reviewPrescription, savePrescription, submitPrescription } from '../services/pharmacyApi'
import type { MedicineRow, RxRow } from '../services/pharmacyApi'

const iso = (offset: number) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10)
const TONE: Record<string, 'neutral' | 'info' | 'success' | 'warning' | 'danger'> = { draft: 'neutral', awaiting_review: 'warning', approved: 'info', partially_dispensed: 'info', dispensed: 'success', rejected: 'danger', cancelled: 'neutral', expired: 'danger' }
const METHODS = [['cash', 'Cash'], ['bank_transfer', 'Bank transfer'], ['pos', 'POS terminal'], ['card', 'Card']] as const

/** Prescription records, a pharmacist's review, and dispensing. Restricted medicines can only be dispensed here, against an approved and valid prescription. */
export function PharmacyPrescriptionsPage() {
  const { active } = useBusiness()
  const businessId = active?.id ?? ''
  const rxs = useAsync(() => loadPrescriptions(businessId), [businessId])
  const medicines = useAsync(() => loadMedicines(businessId), [businessId])
  const customers = useAsync(() => listCustomers(businessId).catch(() => []), [businessId])
  const catalog = useAsync(() => loadCatalog(businessId, 'pharmacy'), [businessId])
  const { can } = usePermissions(businessId)
  const [creating, setCreating] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  if (!active) return null
  const enter = can('pharmacy.rx')
  const open = rxs.data?.find((r) => r.id === openId) ?? null
  const list = (rxs.data ?? []).filter((r) => !filter || r.effectiveStatus === filter)
  const refresh = async () => { await Promise.all([rxs.refresh(), medicines.refresh()]) }
  const name = (id: string) => medicines.data?.find((m) => m.id === id)?.name ?? 'Medicine'

  return (
    <>
      <PageHeader title="Prescriptions" description="Record prescriptions, have a pharmacist review them, then dispense. This screen holds health-related information, so only staff with prescription access can see it."
        actions={enter ? <Button onClick={() => setCreating(true)}><Plus className="size-4" aria-hidden /> New prescription</Button> : undefined} />
      {(rxs.error || medicines.error) && <ErrorState message={(rxs.error ?? medicines.error)!} />}
      <div className="mb-3 w-56"><SelectField label="Status" value={filter} onChange={(e) => setFilter(e.target.value)}><option value="">All</option>{['draft', 'awaiting_review', 'approved', 'partially_dispensed', 'dispensed', 'rejected', 'cancelled', 'expired'].map((s) => <option key={s} value={s}>{label(s)}</option>)}</SelectField></div>
      {rxs.loading ? <Spinner /> : list.length === 0 ? <Card><EmptyState title="No prescriptions" description="Enter a prescription and submit it for pharmacist review." /></Card> : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-surface text-left text-xs font-semibold text-ink/70"><tr><th className="p-3">Prescription</th><th className="p-3">Patient</th><th className="p-3">Medicines</th><th className="p-3">Valid until</th><th className="p-3">Status</th><th className="p-3" /></tr></thead>
            <tbody className="divide-y divide-ink/10">
              {list.map((r) => (
                <tr key={r.id}>
                  <td className="p-3 font-medium">{r.number}<div className="text-xs font-normal text-ink/60">{r.prescriber}{r.licence ? ` (${r.licence})` : ''}</div></td>
                  <td className="p-3">{r.patient}</td>
                  <td className="p-3">{r.items.map((i) => `${qty(i.prescribed)} × ${name(i.productId)}`).join(', ')}</td>
                  <td className="p-3">{r.validUntil}</td>
                  <td className="p-3"><Badge tone={TONE[r.effectiveStatus]}>{label(r.effectiveStatus)}</Badge></td>
                  <td className="p-3 text-right"><Button variant="secondary" onClick={() => setOpenId(r.id)}>Open</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      {creating && <NewDialog businessId={businessId} medicines={(medicines.data ?? []).filter((m) => m.active)} customers={customers.data ?? []} onClose={() => setCreating(false)} onSaved={async () => { setCreating(false); await refresh() }} />}
      {open && <DetailDialog businessId={businessId} rx={open} medicines={medicines.data ?? []} locations={catalog.data?.locations ?? []} review={can('pharmacy.dispense')} enter={enter} onClose={() => setOpenId(null)} onChanged={refresh} />}
    </>
  )
}

function NewDialog({ businessId, medicines, customers, onClose, onSaved }: { businessId: string; medicines: MedicineRow[]; customers: { id: string; name: string }[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const runner = useFormRunner(onSaved)
  const [items, setItems] = useState<{ productId: string; quantity: string; directions: string }[]>([{ productId: '', quantity: '', directions: '' }])
  const [problem, setProblem] = useState<string | null>(null)
  const set = (i: number, patch: Partial<(typeof items)[number]>) => setItems(items.map((x, j) => (j === i ? { ...x, ...patch } : x)))
  async function save(submit: boolean, f: FormData) {
    const s = (k: string) => String(f.get(k) ?? '').trim()
    if (s('patient').length < 2) return setProblem('Enter the patient name.')
    if (s('prescriber').length < 2) return setProblem('Enter the prescriber name.')
    if (!s('date') || !s('valid') || s('valid') < s('date')) return setProblem('The prescription must be valid from its date.')
    if (items.some((x) => !x.productId || !(Number(x.quantity) > 0))) return setProblem('Each line needs a medicine and a quantity above zero.')
    setProblem(null)
    await runner.run((k) => savePrescription(businessId, { id: null, customerId: s('customer') || null, patient: s('patient'), prescriber: s('prescriber'), licence: s('licence'), prescribedOn: s('date'), validUntil: s('valid'), refills: Number(s('refills') || 0), notes: s('notes'), submit, items: items.map((x) => ({ productId: x.productId, quantity: Number(x.quantity), directions: x.directions })) }, k), submit ? 'Submitted for review.' : 'Draft saved.')
  }
  return (
    <Dialog title="New prescription" onClose={onClose} wide>
      <form onSubmit={(e) => { e.preventDefault(); void save(true, new FormData(e.currentTarget)) }} noValidate className="space-y-4" id="rx-form">
        <div className="grid gap-4 sm:grid-cols-3">
          <TextField label="Patient name" name="patient" autoFocus />
          <SelectField label="Customer record (optional)" name="customer" defaultValue=""><option value="">None</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</SelectField>
          <TextField label="Refills permitted" name="refills" type="number" min="0" max="12" defaultValue="0" hint="For your record; each fill is reviewed." />
          <TextField label="Prescriber" name="prescriber" />
          <TextField label="Prescriber licence number" name="licence" />
          <div className="grid grid-cols-2 gap-2"><TextField label="Prescribed on" name="date" type="date" defaultValue={iso(0)} max={iso(0)} /><TextField label="Valid until" name="valid" type="date" defaultValue={iso(30)} /></div>
        </div>
        {items.map((l, i) => {
          const m = medicines.find((x) => x.id === l.productId)
          return (
            <div key={i} className="grid items-end gap-2 sm:grid-cols-[1.5fr_120px_1.5fr_auto]">
              <SelectField label={i === 0 ? 'Medicine' : ' '} value={l.productId} onChange={(e) => set(i, { productId: e.target.value })}><option value="">Select…</option>{medicines.map((x) => <option key={x.id} value={x.id}>{x.name}{x.strength ? ` ${x.strength}` : ''} ({CLASS_LABEL[x.classification]})</option>)}</SelectField>
              <TextField label={i === 0 ? `Quantity${m ? ` (${m.unit})` : ''}` : ' '} type="number" min="0" step="any" value={l.quantity} onChange={(e) => set(i, { quantity: e.target.value })} />
              <TextField label={i === 0 ? 'Directions' : ' '} value={l.directions} onChange={(e) => set(i, { directions: e.target.value })} placeholder="e.g. One capsule three times a day" />
              <button type="button" aria-label="Remove line" disabled={items.length === 1} onClick={() => setItems(items.filter((_, j) => j !== i))} className="mb-2 p-2 text-ink/50 hover:text-danger disabled:opacity-30"><X className="size-4" aria-hidden /></button>
            </div>
          )
        })}
        <Button type="button" variant="ghost" onClick={() => setItems([...items, { productId: '', quantity: '', directions: '' }])}><Plus className="size-4" aria-hidden /> Add medicine</Button>
        <TextField label="Notes (optional)" name="notes" />
        {(problem || runner.error) && <ErrorState title="Not saved" message={(problem ?? runner.error)!} />}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="button" variant="secondary" loading={runner.busy} onClick={() => void save(false, new FormData(document.getElementById('rx-form') as HTMLFormElement))}>Save draft</Button>
          <Button type="submit" loading={runner.busy}>Submit for review</Button>
        </div>
      </form>
    </Dialog>
  )
}

function DetailDialog({ businessId, rx, medicines, locations, review, enter, onClose, onChanged }: { businessId: string; rx: RxRow; medicines: MedicineRow[]; locations: { id: string; name: string }[]; review: boolean; enter: boolean; onClose: () => void; onChanged: () => Promise<void> }) {
  const runner = useFormRunner(onChanged)
  const [note, setNote] = useState('')
  const [pick, setPick] = useState<Record<string, string>>({})
  const [method, setMethod] = useState('cash'); const [location, setLocation] = useState(locations[0]?.id ?? ''); const [paid, setPaid] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const med = (id: string) => medicines.find((m) => m.id === id)
  const st = rx.effectiveStatus
  const lines = rx.items.map((i) => ({ i, left: Math.round((i.prescribed - i.dispensed) * 10000) / 10000, q: Number(pick[i.id] ?? 0) }))
  const total = Math.round(lines.reduce((a, l) => a + l.q * (med(l.i.productId)?.price ?? 0) * 100, 0)) / 100
  const canDispense = review && (st === 'approved' || st === 'partially_dispensed')

  function doDispense() {
    const chosen = lines.filter((l) => l.q > 0)
    if (!chosen.length) return setProblem('Enter a quantity to dispense for at least one medicine.')
    if (chosen.some((l) => l.q > l.left)) return setProblem('You cannot dispense more than remains on the prescription.')
    const amount = paid === '' ? total : Number(paid)
    if (!(amount >= 0) || amount > total) return setProblem('The amount paid cannot be more than the total.')
    setProblem(null)
    void runner.run((k) => dispense(businessId, rx.id, location, chosen.map((l) => ({ itemId: l.i.id, quantity: l.q })), amount > 0 ? [{ method, amount }] : [], k), 'Dispensed.')
  }
  return (
    <Dialog title={`${rx.number}: ${rx.patient}`} onClose={onClose} wide>
      <div className="space-y-4 text-sm">
        <p><Badge tone={TONE[st]}>{label(st)}</Badge> <span className="text-ink/70">Prescribed by {rx.prescriber}{rx.licence ? ` (${rx.licence})` : ''} on {rx.prescribedOn}, valid until {rx.validUntil}.{rx.refills > 0 ? ` ${rx.refills} refill${rx.refills === 1 ? '' : 's'} permitted.` : ''}</span></p>
        {rx.reviewNote && <Notice>Review note: {rx.reviewNote}</Notice>}
        <table className="w-full">
          <thead className="text-left text-xs font-semibold text-ink/70"><tr><th className="py-1">Medicine</th><th className="py-1 text-right">Prescribed</th><th className="py-1 text-right">Dispensed</th>{canDispense && <th className="w-28 py-1 text-right">Dispense now</th>}</tr></thead>
          <tbody className="divide-y divide-ink/10">
            {lines.map(({ i, left }) => (
              <tr key={i.id}>
                <td className="py-2 font-medium">{med(i.productId)?.name ?? 'Medicine'} <Badge tone={med(i.productId)?.classification === 'controlled' ? 'danger' : 'neutral'}>{CLASS_LABEL[med(i.productId)?.classification ?? 'otc']}</Badge><div className="text-xs font-normal text-ink/60">{i.directions}</div></td>
                <td className="tabular py-2 text-right">{qty(i.prescribed)}</td><td className="tabular py-2 text-right">{qty(i.dispensed)}</td>
                {canDispense && <td className="py-2 text-right">{left > 0 ? <input aria-label={`Dispense ${med(i.productId)?.name}`} type="number" min="0" max={left} step="any" value={pick[i.id] ?? ''} onChange={(e) => setPick({ ...pick, [i.id]: e.target.value })} className="tabular w-24 rounded-md border border-line px-2 py-1 text-right" /> : '–'}</td>}
              </tr>
            ))}
          </tbody>
        </table>
        {canDispense && (
          <div className="rounded-md border border-line p-3">
            <h3 className="mb-2 font-semibold">Dispense</h3>
            <div className="grid gap-3 sm:grid-cols-4">
              {locations.length > 1 && <SelectField label="From" value={location} onChange={(e) => setLocation(e.target.value)}>{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</SelectField>}
              <SelectField label="Payment" value={method} onChange={(e) => setMethod(e.target.value)}>{METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</SelectField>
              <TextField label="Amount paid" type="number" min="0" step="0.01" value={paid} placeholder={String(total)} onChange={(e) => setPaid(e.target.value)} hint={`Total ${naira(total)}`} />
            </div>
            <p className="mt-2 text-xs text-ink/60">Stock leaves the earliest-expiring valid batch. The dispensing is recorded with your name and creates a normal sale and receipt.</p>
            <div className="mt-3 flex justify-end"><Button loading={runner.busy} onClick={doDispense}>Dispense</Button></div>
          </div>
        )}
        {st === 'awaiting_review' && review && (
          <div className="rounded-md border border-line p-3">
            <h3 className="mb-2 font-semibold">Pharmacist review</h3>
            <p className="mb-2 text-xs text-ink/60">Your professional review is recorded. The system does not judge whether the prescription is clinically appropriate.</p>
            <TextField label="Review note (required to reject)" value={note} onChange={(e) => setNote(e.target.value)} />
            <div className="mt-3 flex justify-end gap-2">
              <Button variant="secondary" loading={runner.busy} disabled={note.trim().length < 3} onClick={() => void runner.run(async () => reviewPrescription(businessId, rx.id, 'reject', note), 'Rejected.')}>Reject</Button>
              <Button loading={runner.busy} onClick={() => void runner.run(async () => reviewPrescription(businessId, rx.id, 'approve', note), 'Approved for dispensing.')}>Approve for dispensing</Button>
            </div>
          </div>
        )}
        {st === 'awaiting_review' && !review && <Notice>A pharmacist must review this prescription before anything is dispensed.</Notice>}
        {(problem || runner.error) && <ErrorState title="Not done" message={(problem ?? runner.error)!} />}
        <div className="flex flex-wrap justify-end gap-2">
          {st === 'draft' && enter && <Button loading={runner.busy} onClick={() => void runner.run(async () => submitPrescription(businessId, rx.id), 'Submitted for review.')}>Submit for review</Button>}
          {enter && !['dispensed', 'cancelled', 'rejected', 'expired'].includes(st) && <Button variant="ghost" onClick={() => { const why = window.prompt('Reason for cancelling this prescription?'); if (why) void runner.run(async () => cancelPrescription(businessId, rx.id, why), 'Cancelled.') }}>Cancel prescription</Button>}
          <Button variant="secondary" onClick={onClose}>Close</Button>
        </div>
      </div>
    </Dialog>
  )
}
