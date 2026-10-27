import { MessageCircle, Printer } from 'lucide-react'
import { useState } from 'react'
import { Button, ErrorState, Spinner } from '@/shared/components'
import { Dialog } from '@/shared/components/dialog'
import { useAsync } from '@/shared/hooks/useAsync'
import { dateTime, label, naira, qty } from '@/shared/utilities/format'
import { receiptData } from '@/modules/sales/tradeApi'
import { receiptText } from '@/modules/sales/till'
import { whatsappUrl } from '@/shared/utilities/contact'

/** Printable receipt (80mm thermal-friendly). Figures come from the database record, not the browser cart. */
export function ReceiptDialog({ businessId, saleId, onClose }: { businessId: string; saleId: string; onClose: () => void }) {
  const { data, error, loading } = useAsync(() => receiptData(businessId, saleId), [businessId, saleId])
  const [phone, setPhone] = useState<string | null>(null)
  return (
    <Dialog title="Receipt" onClose={onClose}>
      {loading && <Spinner />}
      {error && <ErrorState message={error} />}
      {data && (
        <>
          <div className="receipt-print mx-auto max-w-xs rounded-md border border-dashed border-ink/20 p-4 text-sm">
            <p className="text-center text-lg font-semibold">{data.business.name}</p>
            <p className="text-center text-xs text-ink/60">{data.sale.sale_number} · {dateTime(data.sale.sold_at)}</p>
            {data.customer && <p className="text-center text-xs">Customer: {data.customer.name}</p>}
            <hr className="my-2 border-ink/20" />
            {data.items.map((i, idx) => (
              <div key={idx} className="mb-1">
                <div className="flex justify-between gap-2"><span>{i.description}</span><span className="tabular">{naira(i.total)}</span></div>
                <div className="text-xs text-ink/60">{qty(i.quantity)} × {naira(i.unit_price)}{i.discount > 0 ? ` (−${naira(i.discount)})` : ''}{i.tax > 0 ? ` +tax ${naira(i.tax)}` : ''}</div>
              </div>
            ))}
            <hr className="my-2 border-ink/20" />
            <Row k="Subtotal" v={data.sale.subtotal} />
            {data.sale.discount_total > 0 && <Row k="Discount" v={-data.sale.discount_total} />}
            {data.sale.tax_total > 0 && <Row k="Tax" v={data.sale.tax_total} />}
            <Row k="Total" v={data.sale.grand_total} strong />
            {data.payments.filter((p) => p.status === 'successful').map((p, i) => (
              <Row key={i} k={`${p.type === 'refund' ? 'Refund' : 'Paid'} (${label(p.method)})`} v={p.type === 'refund' ? -p.amount : p.amount} />
            ))}
            {data.sale.balance_due > 0 && <Row k="Balance due" v={data.sale.balance_due} strong />}
            <p className="mt-3 text-center text-xs text-ink/60">Thank you for your business.</p>
          </div>
          <div className="no-print mt-4 flex flex-wrap items-end justify-end gap-2">
            <label className="text-xs text-ink/70">Send on WhatsApp
              <input aria-label="Customer's WhatsApp number" value={phone ?? data.customer?.phone ?? ''} onChange={(e) => setPhone(e.target.value)} placeholder="0803 123 4567" className="mt-1 block w-40 rounded-md border border-line px-2 py-1.5 text-sm" />
            </label>
            {(phone ?? data.customer?.phone) ? <a href={whatsappUrl(phone ?? data.customer?.phone ?? '', receiptText({ business: data.business.name, number: data.sale.sale_number, at: data.sale.sold_at, customer: data.customer?.name, items: data.items.map((i) => ({ description: i.description, quantity: i.quantity, total: i.total })), total: data.sale.grand_total, paid: data.sale.amount_paid, balance: data.sale.balance_due }, naira))} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center gap-2 rounded-md border border-line bg-white px-3 text-sm font-semibold hover:bg-surface"><MessageCircle className="size-4" aria-hidden /> Send</a> : null}
            <Button onClick={() => window.print()}><Printer className="size-4" /> Print or save as PDF</Button>
          </div>
        </>
      )}
    </Dialog>
  )
}

function Row({ k, v, strong }: { k: string; v: number; strong?: boolean }) {
  return <div className={`flex justify-between gap-2 ${strong ? 'font-semibold' : ''}`}><span>{k}</span><span className="tabular">{v < 0 ? '−' : ''}{naira(Math.abs(v))}</span></div>
}
