import { useState } from 'react'
import type { FormEvent } from 'react'
import { useBusiness } from '@/core/business-context/BusinessProvider'
import { useAsync } from '@/shared/hooks/useAsync'
import { Button, Card, EmptyState, ErrorState, PageHeader, Spinner, TextField } from '@/shared/components'
import * as api from '@/modules/sales/tradeApi'

export function SuppliersPage() {
  const { active } = useBusiness()
  const businessId = active?.id ?? ''
  const suppliers = useAsync(() => api.listSuppliers(businessId), [businessId])
  const perms = useAsync(() => api.myTradePermissions(businessId), [businessId])
  const [error, setError] = useState<string | null>(null)
  const [fieldErr, setFieldErr] = useState<string | null>(null)
  if (!active) return null
  const can = (p: string) => perms.data?.includes(p) ?? false

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
      <PageHeader title="Suppliers" description="Who you buy from. Orders, deliveries and payments are on the Purchases page." />
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
          <ul className="divide-y divide-navy/10 text-sm">
            {suppliers.data.map((s) => <li key={s.id} className="p-3"><b>{s.name}</b><div className="text-xs text-navy/60">{s.phone ?? 'No phone'}</div></li>)}
          </ul>
        </Card>
      )}
    </>
  )
}
