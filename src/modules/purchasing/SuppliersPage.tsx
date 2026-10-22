import { Pencil } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { useBusiness } from '@/core/business-context/BusinessProvider'
import { useAsync } from '@/shared/hooks/useAsync'
import { Badge, Button, Card, EmptyState, ErrorState, Notice, PageHeader, Spinner, TextField } from '@/shared/components'
import { DetailPage } from '@/shared/components/detail-page'
import { label, naira } from '@/shared/utilities/format'
import * as api from '@/modules/sales/tradeApi'
import type { PurchaseDto, SupplierDto } from '@/modules/sales/tradeApi'

export function SuppliersPage() {
  const { active } = useBusiness()
  const businessId = active?.id ?? ''
  const suppliers = useAsync(() => api.listSuppliers(businessId), [businessId])
  const purchases = useAsync(() => api.listPurchases(businessId).catch(() => [] as PurchaseDto[]), [businessId])
  const perms = useAsync(() => api.myTradePermissions(businessId), [businessId])
  const [error, setError] = useState<string | null>(null)
  const [fieldErr, setFieldErr] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  if (!active) return null
  const can = (p: string) => perms.data?.includes(p) ?? false
  const current = suppliers.data?.find((s) => s.id === open)

  async function add(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget; const f = new FormData(form)
    if (!String(f.get('name')).trim()) return setFieldErr('Enter the supplier name.')
    setFieldErr(null)
    const err = await api.createSupplier(businessId, String(f.get('name')), String(f.get('phone') ?? ''))
    setError(err)
    if (!err) { form.reset(); await suppliers.refresh() }
  }

  return (
    <>
      <PageHeader title="Suppliers" description="Who you buy from. Open a supplier to see their details, what you have bought and what you still owe. Orders, deliveries and payments are on the Purchases page." />
      {(error || suppliers.error) && <ErrorState message={error ?? suppliers.error!} />}
      {can('suppliers.manage') && (
        <Card className="mb-4">
          <form onSubmit={add} noValidate className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto]">
            <TextField label="Name" name="name" error={fieldErr ?? undefined} />
            <TextField label="Phone (optional)" name="phone" />
            <Button type="submit">Add supplier</Button>
          </form>
        </Card>
      )}
      {suppliers.loading ? <Spinner /> : !suppliers.data?.length ? <EmptyState title="No suppliers yet" description="Add a supplier before creating a purchase order." /> : (
        <Card className="p-0">
          <ul className="divide-y divide-ink/10 text-sm">
            {suppliers.data.map((s) => {
              const mine = (purchases.data ?? []).filter((p) => p.supplierId === s.id && p.status !== 'cancelled')
              const owed = mine.reduce((a, p) => a + Math.max(Math.round((p.total - p.amountPaid) * 100), 0), 0) / 100
              return (
                <li key={s.id}>
                  <button type="button" onClick={() => setOpen(s.id)} className="flex w-full items-center justify-between gap-3 p-3 text-left hover:bg-surface">
                    <span><b>{s.name}</b><span className="block text-xs text-ink/60">{[s.contactName, s.phone ?? 'No phone', s.email].filter(Boolean).join(' · ')}</span></span>
                    <span className="text-right text-xs text-ink/60">{mine.length} order{mine.length === 1 ? '' : 's'}{owed > 0 && <b className="tabular ml-2 text-warning">owed {naira(owed)}</b>}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </Card>
      )}
      {current && <SupplierDetail supplier={current} purchases={(purchases.data ?? []).filter((p) => p.supplierId === current.id)} businessId={businessId} canEdit={can('suppliers.manage')} onClose={() => setOpen(null)} onSaved={suppliers.refresh} />}
    </>
  )
}

function SupplierDetail({ supplier: s, purchases, businessId, canEdit, onClose, onSaved }: { supplier: SupplierDto; purchases: PurchaseDto[]; businessId: string; canEdit: boolean; onClose: () => void; onSaved: () => Promise<void> }) {
  const [error, setError] = useState<string | null>(null)
  const [editingDetails, setEditingDetails] = useState(false)
  const live = purchases.filter((p) => p.status !== 'cancelled')
  const total = live.reduce((a, p) => a + Math.round(p.total * 100), 0) / 100
  const paid = live.reduce((a, p) => a + Math.round(p.amountPaid * 100), 0) / 100
  const last = live.map((p) => p.at).sort().at(-1)
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget); const v = (k: string) => String(f.get(k) ?? '')
    const err = await api.updateSupplier(businessId, s.id, { name: v('name'), phone: v('phone'), contactName: v('contact'), email: v('email'), address: v('address') })
    setError(err)
    if (!err) { setEditingDetails(false); await onSaved() }
  }
  return (
    <DetailPage title={s.name} onClose={onClose} wide>
      <div className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-4">
          {[['Orders', String(live.length)], ['Total bought', naira(total)], ['Paid', naira(paid)], ['Still owed', naira(Math.max(Math.round((total - paid) * 100) / 100, 0))]].map(([t, v]) => (
            <div key={t} className="rounded-lg border border-line bg-white p-3"><p className="text-[11px] font-medium uppercase tracking-wide text-ink/60">{t}</p><p className="tabular mt-1 text-lg font-semibold">{v}</p></div>
          ))}
        </div>
        {last && <p className="text-sm text-ink/70">Last order {last.slice(0, 10)}.</p>}
        {error && <ErrorState message={error} />}
        {!editingDetails ? (
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Details</h3>
              {canEdit && <button type="button" onClick={() => setEditingDetails(true)} className="inline-flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-sm font-medium hover:bg-surface"><Pencil className="size-4" aria-hidden /> Edit</button>}
            </div>
            <dl className="grid gap-4 sm:grid-cols-2">
              <div><dt className="text-xs text-ink/60">Name</dt><dd className="text-sm">{s.name || '–'}</dd></div>
              <div><dt className="text-xs text-ink/60">Contact person</dt><dd className="text-sm">{s.contactName || '–'}</dd></div>
              <div><dt className="text-xs text-ink/60">Phone</dt><dd className="text-sm">{s.phone || '–'}</dd></div>
              <div><dt className="text-xs text-ink/60">Email</dt><dd className="text-sm">{s.email || '–'}</dd></div>
              <div className="sm:col-span-2"><dt className="text-xs text-ink/60">Address</dt><dd className="text-sm">{s.address || '–'}</dd></div>
            </dl>
            {!canEdit && <Notice>Your role can view suppliers but not change them.</Notice>}
          </section>
        ) : (
        <form onSubmit={save} noValidate className="space-y-3">
          <h3 className="text-sm font-semibold">Edit details</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField label="Name" name="name" defaultValue={s.name} />
            <TextField label="Contact person" name="contact" defaultValue={s.contactName ?? ''} />
            <TextField label="Phone" name="phone" defaultValue={s.phone ?? ''} />
            <TextField label="Email" name="email" type="email" defaultValue={s.email ?? ''} />
            <div className="sm:col-span-2"><TextField label="Address" name="address" defaultValue={s.address ?? ''} /></div>
          </div>
          <div className="flex items-center gap-3"><Button type="submit">Save changes</Button><Button type="button" variant="secondary" onClick={() => setEditingDetails(false)}>Cancel</Button></div>
        </form>
        )}
        <div>
          <h3 className="mb-1 text-sm font-semibold">Purchase orders</h3>
          {purchases.length === 0 ? <p className="text-sm text-ink/60">Nothing bought from this supplier yet.</p> : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs font-semibold text-ink/70"><tr><th className="py-1">Order</th><th className="py-1">Date</th><th className="py-1">Status</th><th className="py-1">Payment</th><th className="py-1 text-right">Total</th><th className="py-1 text-right">Owing</th></tr></thead>
              <tbody className="divide-y divide-ink/10">
                {purchases.map((p) => (
                  <tr key={p.id}><td className="py-1.5 font-medium">{p.number}</td><td className="py-1.5">{p.at.slice(0, 10)}</td><td className="py-1.5"><Badge tone={p.status === 'cancelled' ? 'danger' : 'neutral'}>{label(p.status)}</Badge></td><td className="py-1.5">{label(p.paymentStatus)}</td>
                    <td className="tabular py-1.5 text-right">{naira(p.total)}</td><td className="tabular py-1.5 text-right">{p.status === 'cancelled' ? '–' : naira(Math.max(p.total - p.amountPaid, 0))}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </DetailPage>
  )
}
