import { Plus } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { Badge, Button, Card, EmptyState, ErrorState, Notice, PageHeader, SelectField, Spinner, TextField } from '@/shared/components'
import { DetailPage } from '@/shared/components/detail-page'
import { Dialog } from '@/shared/components/dialog'
import { useAsync } from '@/shared/hooks/useAsync'
import { useFormRunner } from '@/shared/hooks/useFormRunner'
import { label, naira } from '@/shared/utilities/format'
import { NoSetup, downloadCsv, useSchool } from '../components/schoolUi'
import { adjustBill, generateBills, loadBills, loadFeeItems, loadPayments, saveFeeItem } from '../services/schoolApi'
import type { BillRow, SFeeItem } from '../services/schoolApi'
import { PaymentDialog } from './SchoolPaymentsPage'

const TONE = { paid: 'success', partially_paid: 'warning', unpaid: 'neutral', overdue: 'danger' } as const

/** Fee items (what the school charges), bills for each student and term, and what is still owed. */
export function SchoolFeesPage() {
  const ctx = useSchool()
  const { businessId, s, can, className, termName, currentTerm, active } = ctx
  const items = useAsync(() => loadFeeItems(businessId), [businessId])
  const bills = useAsync(() => loadBills(businessId), [businessId])
  const [tab, setTab] = useState<'bills' | 'items'>('bills')
  const [term, setTerm] = useState(''); const [cls, setCls] = useState(''); const [state, setState] = useState(''); const [q, setQ] = useState('')
  const [item, setItem] = useState<SFeeItem | 'new' | null>(null); const [gen, setGen] = useState(false); const [openId, setOpenId] = useState<string | null>(null)
  if (!active) return null
  const manage = can('school.fees.manage')
  const t = term || currentTerm?.id || ''
  const list = (bills.data ?? []).filter((b) => b.termId === t && (!state || b.status === state) && (!cls || s?.classes.find((c) => c.id === cls)?.name === b.className) && (!q.trim() || (b.studentName + b.admissionNo + b.number).toLowerCase().includes(q.trim().toLowerCase())))
  const sum = (f: (b: BillRow) => number) => list.reduce((a, b) => a + f(b), 0)
  const open = bills.data?.find((b) => b.id === openId) ?? null
  const refresh = async () => { await Promise.all([items.refresh(), bills.refresh()]) }

  return (
    <>
      <PageHeader title="School Fees" description="Set what the school charges, make a bill for every student, and see who has paid. Money is never edited after it is recorded; mistakes are reversed."
        actions={<div className="flex flex-wrap gap-2">
          <Button variant="secondary" disabled={!list.length} onClick={() => downloadCsv('fee-bills', [['Bill', 'Student', 'Admission no', 'Class', 'Payable', 'Paid', 'Balance', 'Status'], ...list.map((b) => [b.number, b.studentName, b.admissionNo, b.className ?? '', b.payable, b.paid, b.balance, b.status])])}>Export CSV</Button>
          {manage && <Button variant="secondary" onClick={() => setItem('new')}><Plus className="size-4" aria-hidden /> Add fee</Button>}
          {manage && <Button onClick={() => setGen(true)}>Make bills</Button>}
        </div>} />
      {s && !s.terms.length && <NoSetup />}
      <div className="mb-3 flex gap-1">{([['bills', 'Bills'], ['items', 'Fee list']] as const).map(([id, x]) => <Button key={id} variant={tab === id ? 'primary' : 'secondary'} onClick={() => setTab(id)}>{x}</Button>)}</div>
      {(bills.error || items.error) && <ErrorState message={(bills.error ?? items.error)!} />}

      {tab === 'bills' && (
        <>
          <div className="mb-3 flex flex-wrap items-end gap-3">
            <div className="w-48"><SelectField label="Term" value={t} onChange={(e) => setTerm(e.target.value)}>{(s?.terms ?? []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</SelectField></div>
            <div className="w-44"><SelectField label="Class" value={cls} onChange={(e) => setCls(e.target.value)}><option value="">All classes</option>{ctx.classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</SelectField></div>
            <div className="w-44"><SelectField label="Status" value={state} onChange={(e) => setState(e.target.value)}><option value="">All</option>{Object.keys(TONE).map((x) => <option key={x} value={x}>{label(x)}</option>)}</SelectField></div>
            <div className="w-56"><TextField label="Search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Student or bill number" /></div>
          </div>
          <div className="mb-3 grid gap-3 sm:grid-cols-3">{[['Billed', sum((b) => b.payable)], ['Collected', sum((b) => b.paid)], ['Still owed', sum((b) => b.balance)]].map(([k, v]) => <Card key={k as string}><p className="text-xs uppercase text-ink/60">{k}</p><p className="tabular text-xl font-semibold">{naira(v as number)}</p></Card>)}</div>
          {bills.loading ? <Spinner /> : !list.length ? <Card><EmptyState title="No bills" description={manage ? 'Use "Make bills" to bill every student for this term.' : 'No bills match.'} /></Card> : (
            <Card className="overflow-x-auto p-0"><table className="w-full text-sm"><thead className="bg-surface text-left text-xs font-semibold text-ink/70"><tr><th className="p-3">Bill</th><th className="p-3">Student</th><th className="p-3">Class</th><th className="p-3 text-right">Payable</th><th className="p-3 text-right">Paid</th><th className="p-3 text-right">Balance</th><th className="p-3">Status</th></tr></thead>
              <tbody className="divide-y divide-ink/10">{list.map((b) => <tr key={b.id} onClick={() => setOpenId(b.id)} className="cursor-pointer hover:bg-surface"><td className="p-3">{b.number}</td><td className="p-3 font-medium">{b.studentName}</td><td className="p-3">{b.className ?? '–'}</td><td className="tabular p-3 text-right">{naira(b.payable)}</td><td className="tabular p-3 text-right">{naira(b.paid)}</td><td className="tabular p-3 text-right font-medium">{naira(b.balance)}</td><td className="p-3"><Badge tone={TONE[b.status]}>{label(b.status)}</Badge></td></tr>)}</tbody></table></Card>
          )}
        </>
      )}

      {tab === 'items' && (items.loading ? <Spinner /> : !items.data?.length ? <Card><EmptyState title="No fees yet" description="Add the fees the school charges, such as tuition, books or uniform." /></Card> : (
        <Card className="overflow-x-auto p-0"><table className="w-full text-sm"><thead className="bg-surface text-left text-xs font-semibold text-ink/70"><tr><th className="p-3">Fee</th><th className="p-3 text-right">Amount</th><th className="p-3">Applies to</th><th className="p-3">Term</th><th className="p-3">When</th><th className="p-3">State</th></tr></thead>
          <tbody className="divide-y divide-ink/10">{items.data.map((f) => <tr key={f.id} onClick={() => manage && setItem(f)} className={manage ? 'cursor-pointer hover:bg-surface' : ''}><td className="p-3 font-medium">{f.name}</td><td className="tabular p-3 text-right">{naira(f.amount)}</td><td className="p-3">{f.classId ? className(f.classId) : 'Every class'}</td><td className="p-3">{f.termId ? termName(f.termId) : 'Every term'}</td><td className="p-3">{f.onAdmission ? 'New admission' : 'Each term'}</td><td className="p-3"><Badge tone={f.active ? 'success' : 'neutral'}>{f.active ? 'In use' : 'Stopped'}</Badge></td></tr>)}</tbody></table></Card>
      ))}

      {item && <FeeDialog ctx={ctx} item={item === 'new' ? null : item} onClose={() => setItem(null)} onSaved={async () => { setItem(null); await refresh() }} />}
      {gen && <GenerateDialog ctx={ctx} defaultTerm={t} onClose={() => setGen(false)} onDone={async () => { await refresh() }} />}
      {open && <BillPage ctx={ctx} bill={open} onClose={() => setOpenId(null)} onChanged={refresh} />}
    </>
  )
}

function FeeDialog({ ctx, item, onClose, onSaved }: { ctx: ReturnType<typeof useSchool>; item: SFeeItem | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const runner = useFormRunner(onSaved)
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const f = new FormData(e.currentTarget)
    await runner.run(async () => saveFeeItem(ctx.businessId, { id: item?.id ?? null, name: String(f.get('name')).trim(), amount: Number(f.get('amount')), classId: String(f.get('class')) || null, termId: String(f.get('term')) || null, onAdmission: f.get('when') === 'admission', active: f.get('active') === 'on' }), 'Saved.')
  }
  return (
    <Dialog title={item ? 'Edit fee' : 'Add a fee'} onClose={onClose}>
      <form onSubmit={submit} noValidate className="space-y-3">
        <TextField label="Name" name="name" defaultValue={item?.name} placeholder="Tuition, Books, Uniform" autoFocus />
        <TextField label="Amount (₦)" name="amount" type="number" min={0} step="any" defaultValue={item?.amount} />
        <SelectField label="Applies to" name="class" defaultValue={item?.classId ?? ''}><option value="">Every class</option>{ctx.classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</SelectField>
        <SelectField label="Term" name="term" defaultValue={item?.termId ?? ''}><option value="">Every term</option>{(ctx.s?.terms ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</SelectField>
        <SelectField label="Charged" name="when" defaultValue={item?.onAdmission ? 'admission' : 'term'}><option value="term">Every term</option><option value="admission">Once, when a student is admitted</option></SelectField>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={item?.active ?? true} /> In use (untick to stop charging it on new bills)</label>
        <Notice>Changing a fee does not change bills already made.</Notice>
        {runner.error && <ErrorState title="Not saved" message={runner.error} />}
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={runner.busy}>Save</Button></div>
      </form>
    </Dialog>
  )
}

function GenerateDialog({ ctx, defaultTerm, onClose, onDone }: { ctx: ReturnType<typeof useSchool>; defaultTerm: string; onClose: () => void; onDone: () => Promise<void> }) {
  const runner = useFormRunner(onDone)
  const [term, setTerm] = useState(defaultTerm); const [cls, setCls] = useState(''); const [due, setDue] = useState(''); const [result, setResult] = useState<string | null>(null)
  return (
    <Dialog title="Make bills" onClose={onClose}>
      <div className="space-y-3">
        <SelectField label="Term" value={term} onChange={(e) => setTerm(e.target.value)}>{(ctx.s?.terms ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</SelectField>
        <SelectField label="Class" value={cls} onChange={(e) => setCls(e.target.value)}><option value="">All classes</option>{ctx.classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</SelectField>
        <TextField label="Pay by (optional)" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        <Notice>Active students get one bill for the term from the fees that apply to their class. A student who already has a bill for this term is skipped, so running it again is safe.</Notice>
        {result && <Notice>{result}</Notice>}
        {runner.error && <ErrorState title="No bills made" message={runner.error} />}
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Close</Button><Button disabled={!term} loading={runner.busy} onClick={() => void runner.run(async (k) => { const r = await generateBills(ctx.businessId, term, cls || null, due || null, k); if (!r.error) setResult(`${r.created} bill(s) made, ${r.skipped} already had one.`); return r.error }, 'Done.')}>Make bills</Button></div>
      </div>
    </Dialog>
  )
}

function BillPage({ ctx, bill: b, onClose, onChanged }: { ctx: ReturnType<typeof useSchool>; bill: BillRow; onClose: () => void; onChanged: () => Promise<void> }) {
  const { businessId, can, termName } = ctx
  const pays = useAsync(() => loadPayments(businessId).catch(() => []), [businessId])
  const runner = useFormRunner(onChanged)
  const [paying, setPaying] = useState(false); const [adjusting, setAdjusting] = useState(false)
  const [disc, setDisc] = useState(String(b.discount || '')); const [reason, setReason] = useState(b.discountReason ?? ''); const [cn, setCn] = useState(''); const [ca, setCa] = useState('')
  const mine = (pays.data ?? []).filter((p) => p.billId === b.id)
  return (
    <DetailPage title={`Bill ${b.number}`} onClose={onClose} wide actions={can('school.fees.record') && b.balance > 0 ? <Button onClick={() => setPaying(true)}>Record payment</Button> : undefined}>
      <p className="mb-3 text-sm text-ink/70">{b.studentName} · {b.admissionNo} · {b.className ?? '–'} · {termName(b.termId)} {b.dueOn && `· pay by ${b.dueOn}`} <Badge tone={TONE[b.status]}>{label(b.status)}</Badge></p>
      <table className="mb-3 w-full text-sm"><tbody className="divide-y divide-ink/10">
        {b.items.map((i, n) => <tr key={n}><td className="py-1.5">{i.name}</td><td className="tabular py-1.5 text-right">{naira(i.amount)}</td></tr>)}
        {b.discount > 0 && <tr><td className="py-1.5">Discount{b.discountReason ? ` (${b.discountReason})` : ''}</td><td className="tabular py-1.5 text-right">-{naira(b.discount)}</td></tr>}
        <tr className="font-semibold"><td className="py-1.5">Payable</td><td className="tabular py-1.5 text-right">{naira(b.payable)}</td></tr>
        <tr><td className="py-1.5">Paid</td><td className="tabular py-1.5 text-right">{naira(b.paid)}</td></tr>
        <tr className="font-semibold"><td className="py-1.5">Balance</td><td className="tabular py-1.5 text-right">{naira(b.balance)}</td></tr>
      </tbody></table>
      <h3 className="mb-1 text-sm font-semibold">Payments</h3>
      {mine.length ? <ul className="divide-y divide-ink/10 text-sm">{mine.map((p) => <li key={p.id} className="flex justify-between py-1.5"><span>{p.receipt} · {p.paidOn} · {label(p.method)}{p.status === 'reversed' && <Badge tone="danger">Reversed</Badge>}</span><b className="tabular">{naira(p.amount)}</b></li>)}</ul> : <p className="text-sm text-ink/60">No payments yet.</p>}
      {can('school.fees.manage') && <div className="no-print mt-4 border-t border-line pt-3"><Button variant="secondary" onClick={() => setAdjusting(!adjusting)}>{adjusting ? 'Hide adjustments' : 'Discount or extra charge'}</Button>
        {adjusting && <div className="mt-3 space-y-3"><div className="grid gap-3 sm:grid-cols-2"><TextField label="Discount (₦)" type="number" min={0} value={disc} onChange={(e) => setDisc(e.target.value)} /><TextField label="Reason for discount" value={reason} onChange={(e) => setReason(e.target.value)} /><TextField label="Extra charge name" value={cn} onChange={(e) => setCn(e.target.value)} /><TextField label="Extra charge amount (₦)" type="number" min={0} value={ca} onChange={(e) => setCa(e.target.value)} /></div>
          {runner.error && <ErrorState title="Not saved" message={runner.error} />}{runner.ok && <Notice>{runner.ok}</Notice>}
          <Button loading={runner.busy} onClick={() => void runner.run(async () => adjustBill(businessId, b.id, { discount: disc === '' ? null : Number(disc), reason, chargeName: cn, chargeAmount: ca === '' ? null : Number(ca) }), 'Bill updated.')}>Save adjustment</Button></div>}</div>}
      {paying && <PaymentDialog ctx={ctx} bill={b} onClose={() => setPaying(false)} onSaved={async () => { setPaying(false); await onChanged(); await pays.refresh() }} />}
    </DetailPage>
  )
}
