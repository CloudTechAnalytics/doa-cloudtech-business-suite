import { Plus } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { useBusiness } from '@/core/business-context/BusinessProvider'
import { myFinancePermissions } from '@/modules/finance/financeApi'
import { listSuppliers, loadCatalog } from '@/modules/sales/tradeApi'
import { Badge, Button, Card, EmptyState, ErrorState, Notice, PageHeader, SelectField, Spinner, TextField } from '@/shared/components'
import { Dialog } from '@/shared/components/dialog'
import { DetailPage } from '@/shared/components/detail-page'
import { useAsync } from '@/shared/hooks/useAsync'
import { useFormRunner } from '@/shared/hooks/useFormRunner'
import { dateTime, label, qty } from '@/shared/utilities/format'
import { blankLine, LinesEditor } from './LinesEditor'
import type { EditorLine } from './LinesEditor'
import { cancelRequest, createRequest, decideRequest, listRequests, orderRequest } from './ordersApi'
import type { RequestDto } from './ordersApi'

const TONE: Record<RequestDto['status'], 'info' | 'success' | 'danger' | 'neutral' | 'warning'> = { requested: 'warning', approved: 'info', rejected: 'danger', ordered: 'success', cancelled: 'neutral' }

/** Ask for something to be bought, get it approved, then turn it into a purchase order. Nothing changes stock or money here. */
export function PurchaseRequestsPage() {
  const { active } = useBusiness()
  const businessId = active?.id ?? ''
  const requests = useAsync(() => listRequests(businessId), [businessId])
  const catalog = useAsync(() => loadCatalog(businessId, active?.industry ?? 'farm'), [businessId, active?.industry])
  const suppliers = useAsync(() => listSuppliers(businessId).catch(() => []), [businessId])
  const perms = useAsync(() => myFinancePermissions(businessId), [businessId])
  const [creating, setCreating] = useState(false)
  const [deciding, setDeciding] = useState<{ r: RequestDto; approve: boolean } | null>(null)
  const [ordering, setOrdering] = useState<RequestDto | null>(null)
  const runner = useFormRunner(async () => { await requests.refresh() })
  if (!active) return null
  const can = (p: string) => perms.data?.includes(p) ?? false
  const product = (id: string) => catalog.data?.products.find((p) => p.id === id)

  return (
    <>
      <PageHeader title="Purchase requests" description="Ask for supplies, have a manager approve, then order. A request never changes stock or money until it becomes a purchase order that is received."
        actions={can('procurement.request') ? <Button onClick={() => setCreating(true)}><Plus className="size-4" aria-hidden /> New request</Button> : undefined} />
      {(requests.error || runner.error) && <ErrorState message={(runner.error ?? requests.error)!} />}
      {requests.loading ? <Spinner /> : !requests.data?.length ? <Card><EmptyState title="No purchase requests yet" description="Raise a request when feed, medicine or tools are running low." /></Card> : (
        <div className="space-y-3">
          {requests.data.map((r) => (
            <Card key={r.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">{r.number} <Badge tone={TONE[r.status]}>{label(r.status)}</Badge></p>
                  <p className="text-xs text-ink/60">{dateTime(r.requestedAt)}{r.note ? ` · ${r.note}` : ''}</p>
                  {r.decisionNote && <p className="mt-1 text-xs text-ink/70">Decision note: {r.decisionNote}</p>}
                </div>
                <div className="flex flex-wrap gap-2">
                  {r.status === 'requested' && can('procurement.approve') && <><Button onClick={() => setDeciding({ r, approve: true })}>Approve</Button><Button variant="secondary" onClick={() => setDeciding({ r, approve: false })}>Reject</Button></>}
                  {r.status === 'approved' && can('procurement.approve') && <Button onClick={() => setOrdering(r)}>Create purchase order</Button>}
                  {['requested', 'approved'].includes(r.status) && <Button variant="ghost" onClick={() => void runner.run((k) => cancelRequest(businessId, r.id, k), 'Request cancelled.')}>Cancel</Button>}
                </div>
              </div>
              <ul className="mt-3 divide-y divide-ink/10 text-sm">
                {r.items.map((i) => <li key={i.productId} className="flex justify-between gap-3 py-1.5"><span>{product(i.productId)?.name ?? 'Product'}</span><span className="tabular text-ink/70">{qty(i.quantity)} {product(i.productId)?.unit}{i.estimatedCost !== null ? ` · est. ₦${i.estimatedCost.toLocaleString()}` : ''}</span></li>)}
              </ul>
              {r.status === 'ordered' && <p className="mt-2 text-xs text-ink/60">Ordered as a purchase order. Follow it on the Purchases page.</p>}
            </Card>
          ))}
        </div>
      )}
      {creating && catalog.data && <NewRequest businessId={businessId} products={catalog.data.products.filter((p) => p.status === 'active')} onClose={() => setCreating(false)} onSaved={async () => { setCreating(false); await requests.refresh() }} />}
      {deciding && <DecideDialog businessId={businessId} {...deciding} onClose={() => setDeciding(null)} onSaved={async () => { setDeciding(null); await requests.refresh() }} />}
      {ordering && <OrderDialog businessId={businessId} request={ordering} suppliers={suppliers.data ?? []} onClose={() => setOrdering(null)} onSaved={async () => { setOrdering(null); await requests.refresh() }} />}
    </>
  )
}

function NewRequest({ businessId, products, onClose, onSaved }: { businessId: string; products: { id: string; name: string; unit: string; defaultCost: number | null }[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const runner = useFormRunner(onSaved)
  const [lines, setLines] = useState<EditorLine[]>([blankLine()])
  const [problem, setProblem] = useState<string | null>(null)
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const note = String(new FormData(e.currentTarget).get('note') ?? '')
    const clean = lines.filter((l) => l.productId)
    if (!clean.length) return setProblem('Add at least one product.')
    if (clean.some((l) => !(Number(l.quantity) > 0))) return setProblem('Every line needs a quantity above zero.')
    setProblem(null)
    await runner.run((k) => createRequest(businessId, clean.map((l) => ({ productId: l.productId, quantity: Number(l.quantity), estimatedCost: l.cost === '' ? null : Number(l.cost) })), note, k), 'Request sent.')
  }
  return (
    <DetailPage title="New purchase request" onClose={onClose} wide>
      <form onSubmit={submit} noValidate className="space-y-3">
        <LinesEditor lines={lines} setLines={setLines} products={products} costLabel="Estimated cost (₦)" />
        <TextField label="Note (optional)" name="note" placeholder="Why it is needed" />
        {(problem || runner.error) && <ErrorState title="Not sent" message={(problem ?? runner.error)!} />}
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={runner.busy}>Send request</Button></div>
      </form>
    </DetailPage>
  )
}

function DecideDialog({ businessId, r, approve, onClose, onSaved }: { businessId: string; r: RequestDto; approve: boolean; onClose: () => void; onSaved: () => Promise<void> }) {
  const runner = useFormRunner(onSaved)
  const [note, setNote] = useState('')
  return (
    <Dialog title={`${approve ? 'Approve' : 'Reject'} ${r.number}`} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); void runner.run((k) => decideRequest(businessId, r.id, approve, note, k), approve ? 'Request approved.' : 'Request rejected.') }} className="space-y-4">
        <TextField label={approve ? 'Note (optional)' : 'Why is it rejected?'} value={note} onChange={(e) => setNote(e.target.value)} autoFocus />
        <Notice>Someone other than the requester must decide a request, unless the business owner raised it.</Notice>
        {runner.error && <ErrorState title="Not saved" message={runner.error} />}
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={runner.busy} disabled={!approve && note.trim().length < 3}>{approve ? 'Approve' : 'Reject'}</Button></div>
      </form>
    </Dialog>
  )
}

function OrderDialog({ businessId, request, suppliers, onClose, onSaved }: { businessId: string; request: RequestDto; suppliers: { id: string; name: string }[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const runner = useFormRunner(onSaved)
  const [supplier, setSupplier] = useState('')
  return (
    <Dialog title={`Order ${request.number}`} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); void runner.run((k) => orderRequest(businessId, request.id, supplier, k), 'Purchase order created.') }} className="space-y-4">
        <SelectField label="Supplier" value={supplier} onChange={(e) => setSupplier(e.target.value)} hint="Estimated costs become the order's unit costs, or the product's usual cost if none was given.">
          <option value="">Select…</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </SelectField>
        <Notice>This creates a normal purchase order. It needs the Purchases module to be on (Settings, Modules).</Notice>
        {runner.error && <ErrorState title="Not ordered" message={runner.error} />}
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={runner.busy} disabled={!supplier}>Create purchase order</Button></div>
      </form>
    </Dialog>
  )
}
