import { Plus, Printer, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Badge, Button, EmptyState, ErrorState, SelectField, Spinner, TextField } from '@/shared/components'
import { Dialog } from '@/shared/components/dialog'
import { useAsync } from '@/shared/hooks/useAsync'
import { useFormRunner } from '@/shared/hooks/useFormRunner'
import { printSheets } from '@/shared/print/printSheets'
import { label, naira, qty } from '@/shared/utilities/format'
import { listContacts, listDeals, listQuotes, saveQuote, setQuoteStatus } from './dealsApi'
import type { QuoteLine, QuoteRow, QuoteStatus } from './dealsApi'

const TONE: Record<QuoteStatus, 'neutral' | 'info' | 'success' | 'danger'> = { draft: 'neutral', sent: 'info', accepted: 'success', declined: 'danger' }
const date = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric' })

/** A quote as the customer receives it: the business name, number, who it is for, the lines, the total and how long it is valid. */
export function QuoteSheet({ quote, business }: { quote: QuoteRow; business: string }) {
  return (
    <article className="receipt-sheet mx-auto max-w-[190mm] rounded-lg border border-line bg-white p-6 text-[13px] leading-snug text-ink shadow-card sm:p-8" aria-label={`Quote ${quote.number}`}>
      <header className="flex flex-wrap items-start justify-between gap-3 border-b-4 border-double border-ink/70 pb-3">
        <div><h1 className="text-2xl font-extrabold uppercase tracking-wide">{business}</h1></div>
        <div className="text-right"><p className="text-lg font-bold uppercase tracking-[0.2em]">Quote</p><p className="font-semibold">{quote.number}</p></div>
      </header>
      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1.5 sm:grid-cols-3">
        {([['Prepared for', quote.contact || '–'], ['Date', date(quote.issuedOn)], ['Valid until', quote.validUntil ? date(quote.validUntil) : 'Not stated']] as const).map(([k, v]) => (
          <div key={k} className="border-b border-dotted border-ink/30 pb-0.5"><dt className="text-[10px] uppercase tracking-wide text-ink/55">{k}</dt><dd className="font-semibold">{v}</dd></div>
        ))}
      </dl>
      <table data-keep-table className="mt-4 w-full border-collapse text-left">
        <thead><tr className="border-b-2 border-ink/60 text-[11px] uppercase tracking-wide"><th className="py-1">Description</th><th className="py-1 text-right">Qty</th><th className="py-1 text-right">Unit price</th><th className="py-1 text-right">Amount</th></tr></thead>
        <tbody>{quote.lines.map((l, i) => <tr key={i} className="border-b border-ink/15"><td className="py-1.5">{l.description}</td><td className="py-1.5 text-right">{qty(l.quantity)}</td><td className="py-1.5 text-right">{naira(l.unitPrice)}</td><td className="py-1.5 text-right">{naira(Math.round(l.quantity * l.unitPrice * 100) / 100)}</td></tr>)}</tbody>
      </table>
      <div className="mt-3 ml-auto w-full max-w-[16rem] space-y-0.5 text-right">
        {quote.discount > 0 && <><p>Subtotal <b className="ml-3">{naira(quote.subtotal)}</b></p><p>Discount <b className="ml-3">− {naira(quote.discount)}</b></p></>}
        <p className="border-t-2 border-ink/60 pt-1 text-base font-extrabold">Total <span className="ml-3">{naira(quote.total)}</span></p>
      </div>
      {quote.notes && <p className="mt-4 whitespace-pre-line rounded border border-ink/30 p-2.5 text-[12px]"><b>Notes: </b>{quote.notes}</p>}
      <footer className="mt-10 grid grid-cols-2 gap-10 text-center text-[11px]"><div className="border-t border-ink/70 pt-1">Authorised signature</div><div className="border-t border-ink/70 pt-1">Customer acceptance and date</div></footer>
    </article>
  )
}

export const printQuote = (quote: QuoteRow, business: string) => printSheets(<QuoteSheet quote={quote} business={business} />)

export function Quotes({ businessId, businessName, can }: { businessId: string; businessName: string; can: (p: string) => boolean }) {
  const quotes = useAsync(() => listQuotes(businessId), [businessId])
  const [editing, setEditing] = useState<QuoteRow | 'new' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const manage = can('customers.manage')
  if (quotes.loading && !quotes.data) return <Spinner />
  const rows = quotes.data ?? []
  const act = async (id: string, status: 'sent' | 'accepted' | 'declined') => { setError(await setQuoteStatus(businessId, id, status)); await quotes.refresh() }
  return (
    <>
      <div className="mb-3 flex items-center gap-3"><p className="text-sm text-ink/70">Numbered quotes you can print or save as a PDF and send. An accepted quote does not create a sale by itself.</p>{manage && <Button className="ml-auto" onClick={() => setEditing('new')}>New quote</Button>}</div>
      {(error || quotes.error) && <ErrorState message={error ?? quotes.error!} />}
      {rows.length === 0 ? <EmptyState title="No quotes yet" description="Make a quote for a customer, lead or deal, print it, and mark it sent, accepted or declined." /> : (
        <ul className="divide-y divide-ink/10 rounded-lg border border-line bg-white text-sm">
          {rows.map((q) => (
            <li key={q.id} className="flex flex-wrap items-center gap-2 p-3">
              <button className="text-left" onClick={() => setEditing(q)}><b>{q.number}</b> <span className="text-ink/70">· {q.contact || '–'}</span><span className="block text-xs text-ink/60">{naira(q.total)}{q.validUntil ? ` · valid until ${q.validUntil}` : ''}</span></button>
              <Badge tone={TONE[q.status]}>{label(q.status)}</Badge>
              <span className="ml-auto flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => printQuote(q, businessName)}><Printer className="size-4" aria-hidden /> Print</Button>
                {manage && q.status === 'draft' && <Button variant="secondary" onClick={() => void act(q.id, 'sent')}>Mark sent</Button>}
                {manage && q.status === 'sent' && <><Button variant="secondary" onClick={() => void act(q.id, 'accepted')}>Accepted</Button><Button variant="secondary" onClick={() => void act(q.id, 'declined')}>Declined</Button></>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {editing && <QuoteDialog businessId={businessId} businessName={businessName} quote={editing === 'new' ? null : editing} manage={manage} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await quotes.refresh() }} />}
    </>
  )
}

const blank = (): { description: string; quantity: string; unitPrice: string } => ({ description: '', quantity: '1', unitPrice: '' })

function QuoteDialog({ businessId, businessName, quote, manage, onClose, onSaved }: { businessId: string; businessName: string; quote: QuoteRow | null; manage: boolean; onClose: () => void; onSaved: () => Promise<void> }) {
  const contacts = useAsync(() => listContacts(businessId), [businessId])
  const deals = useAsync(() => listDeals(businessId), [businessId])
  const editable = manage && (!quote || quote.status === 'draft')
  const [contact, setContact] = useState(quote ? (quote.customerId ? `customer:${quote.customerId}` : quote.leadId ? `lead:${quote.leadId}` : '') : '')
  const [dealId, setDealId] = useState(quote?.dealId ?? '')
  const [valid, setValid] = useState(quote?.validUntil ?? '')
  const [lines, setLines] = useState(quote ? quote.lines.map((l) => ({ description: l.description, quantity: String(l.quantity), unitPrice: String(l.unitPrice) })) : [blank()])
  const [discount, setDiscount] = useState(quote ? String(quote.discount || '') : '')
  const [notes, setNotes] = useState(quote?.notes ?? '')
  const runner = useFormRunner(onSaved)
  const [kind, id] = contact.split(':')
  const parsed: QuoteLine[] = lines.map((l) => ({ description: l.description, quantity: Number(l.quantity), unitPrice: Number(l.unitPrice) }))
  const subtotal = parsed.reduce((a, l) => a + (l.quantity > 0 && l.unitPrice >= 0 ? Math.round(l.quantity * l.unitPrice * 100) / 100 : 0), 0)
  const set = (i: number, k: 'description' | 'quantity' | 'unitPrice', v: string) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)))
  const list = contacts.data ?? []
  return (
    <Dialog title={quote ? `Quote ${quote.number}` : 'New quote'} onClose={onClose} wide>
      <div className="space-y-3 text-sm">
        {!editable && quote && <p className="rounded-md bg-surface px-3 py-2 text-xs">This quote has been {quote.status}, so it can no longer be changed. Make a new one to change the figures.</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField label="For" value={contact} onChange={(e) => setContact(e.target.value)} disabled={!editable}>
            <option value="">Choose a customer or lead</option>
            {quote && contact && !list.some((c) => `${c.kind}:${c.id}` === contact) && <option value={contact}>{quote.contact}</option>}
            {list.map((c) => <option key={`${c.kind}:${c.id}`} value={`${c.kind}:${c.id}`}>{c.name}{c.kind === 'lead' ? ' (lead)' : ''}</option>)}
          </SelectField>
          <SelectField label="Deal (optional)" value={dealId} onChange={(e) => setDealId(e.target.value)} disabled={!editable}>
            <option value="">Not linked to a deal</option>
            {(deals.data ?? []).map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
          </SelectField>
        </div>
        <TextField label="Valid until" type="date" value={valid} onChange={(e) => setValid(e.target.value)} disabled={!editable} />
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink/60">Lines</p>
          <ul className="space-y-2">
            {lines.map((l, i) => (
              <li key={i} className="grid grid-cols-[1fr_5rem_7rem_auto] items-center gap-2 max-sm:grid-cols-2">
                <input aria-label={`Line ${i + 1} description`} placeholder="Description" value={l.description} onChange={(e) => set(i, 'description', e.target.value)} disabled={!editable} className="rounded-md border border-line px-2 py-1.5 max-sm:col-span-2" />
                <input aria-label={`Line ${i + 1} quantity`} type="number" min={0} step="any" value={l.quantity} onChange={(e) => set(i, 'quantity', e.target.value)} disabled={!editable} className="rounded-md border border-line px-2 py-1.5" />
                <input aria-label={`Line ${i + 1} unit price`} type="number" min={0} step="any" placeholder="Price" value={l.unitPrice} onChange={(e) => set(i, 'unitPrice', e.target.value)} disabled={!editable} className="rounded-md border border-line px-2 py-1.5" />
                {editable && lines.length > 1 && <button type="button" aria-label={`Remove line ${i + 1}`} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} className="p-1.5 text-ink/50 hover:text-danger"><Trash2 className="size-4" aria-hidden /></button>}
              </li>
            ))}
          </ul>
          {editable && <Button variant="secondary" className="mt-2" onClick={() => setLines((ls) => [...ls, blank()])}><Plus className="size-4" aria-hidden /> Add line</Button>}
        </div>
        <div className="grid gap-3 sm:grid-cols-2"><TextField label="Discount (₦)" type="number" min={0} value={discount} onChange={(e) => setDiscount(e.target.value)} disabled={!editable} /><p className="self-end text-right">Total <b className="text-base">{naira(Math.max(0, subtotal - Number(discount || 0)))}</b></p></div>
        <TextField label="Notes shown on the quote" value={notes} onChange={(e) => setNotes(e.target.value)} disabled={!editable} />
        {runner.error && <ErrorState title="Not saved" message={runner.error} />}
        <div className="flex flex-wrap justify-end gap-2">
          {quote && <Button variant="secondary" onClick={() => printQuote(quote, businessName)}><Printer className="size-4" aria-hidden /> Print</Button>}
          <Button variant="secondary" onClick={onClose}>{editable ? 'Cancel' : 'Close'}</Button>
          {editable && <Button loading={runner.busy} onClick={() => void runner.run(async () => saveQuote(businessId, { id: quote?.id ?? null, dealId: dealId || null, customerId: kind === 'customer' ? id : null, leadId: kind === 'lead' ? id : null, validUntil: valid || null, lines: parsed, discount: Number(discount || 0), notes }), 'Saved.')}>Save quote</Button>}
        </div>
      </div>
    </Dialog>
  )
}
