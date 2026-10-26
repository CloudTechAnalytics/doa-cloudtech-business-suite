import { printSheets } from '@/shared/print/printSheets'
import { label, naira } from '@/shared/utilities/format'
import type { BillRow, SPayment } from '../services/schoolApi'

/** Everything a fee receipt shows, gathered so the same sheet serves the bursar, the student's profile and the parent portal. */
export interface ReceiptData {
  school: { name: string; address: string | null; phone: string | null; email: string | null }
  receipt: string; paidOn: string; amount: number; method: string; reference: string | null
  status: 'posted' | 'reversed'; reversalReason: string | null
  student: { name: string; admissionNo: string | null; className: string | null }
  bill: { number: string; term: string | null; items: { name: string; amount: number }[]; discount: number; discountReason: string | null; payable: number; paid: number; balance: number } | null
}

/** Puts a payment, its bill and the school's details together. `bill` may be missing (then the receipt shows the payment alone). */
export function receiptData(
  ctx: { active: { name: string } | null; s?: { settings?: { address: string | null; phone: string | null; email: string | null } | null } | null; termName: (id: string) => string },
  p: Pick<SPayment, 'receipt' | 'paidOn' | 'amount' | 'method' | 'reference' | 'status' | 'reversalReason'> & { studentName: string; billNumber: string },
  bill: BillRow | undefined,
): ReceiptData {
  const st = ctx.s?.settings
  return {
    school: { name: ctx.active?.name ?? 'School', address: st?.address ?? null, phone: st?.phone ?? null, email: st?.email ?? null },
    receipt: p.receipt, paidOn: p.paidOn, amount: p.amount, method: p.method, reference: p.reference, status: p.status, reversalReason: p.reversalReason,
    student: { name: p.studentName, admissionNo: bill?.admissionNo ?? null, className: bill?.className ?? null },
    bill: bill ? { number: bill.number, term: ctx.termName(bill.termId), items: bill.items, discount: bill.discount, discountReason: bill.discountReason, payable: bill.payable, paid: bill.paid, balance: bill.balance } : null,
  }
}

const date = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric' })

/**
 * The fee receipt as the school hands it over: school heading, receipt number and date, who paid for whom, what the bill was for, the amount received and
 * what is still owed, and a place to sign. A reversed payment is stamped so a cancelled receipt cannot pass for a live one.
 */
export function ReceiptSheet({ r }: { r: ReceiptData }) {
  const reversed = r.status === 'reversed'
  return (
    <article className="receipt-sheet relative mx-auto max-w-[150mm] rounded-lg border border-line bg-white p-6 text-[13px] leading-snug text-ink shadow-card sm:p-8" aria-label={`Receipt ${r.receipt}`}>
      {reversed && <div aria-hidden className="pointer-events-none absolute inset-0 grid place-items-center"><span className="-rotate-12 rounded-md border-4 border-danger px-6 py-2 text-5xl font-extrabold uppercase tracking-widest text-danger/25">Reversed</span></div>}
      <header className="border-b-4 border-double border-ink/70 pb-3 text-center">
        <h1 className="text-xl font-extrabold uppercase tracking-wide">{r.school.name}</h1>
        {(r.school.address || r.school.phone || r.school.email) && <p className="mt-0.5 text-xs text-ink/70">{[r.school.address, r.school.phone, r.school.email].filter(Boolean).join('  ·  ')}</p>}
        <p className="mt-2 inline-block rounded-full border border-ink/60 px-4 py-0.5 text-xs font-bold uppercase tracking-[0.2em]">Fee receipt</p>
      </header>

      <div className="mt-4 flex flex-wrap items-end justify-between gap-2">
        <div><p className="text-[10px] uppercase tracking-wide text-ink/55">Receipt no.</p><p className="text-lg font-extrabold tabular">{r.receipt}</p></div>
        <div className="text-right"><p className="text-[10px] uppercase tracking-wide text-ink/55">Date</p><p className="font-semibold">{date(r.paidOn)}</p></div>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1.5">
        {([['Received for', r.student.name], ['Admission no.', r.student.admissionNo ?? '–'], ['Class', r.student.className ?? '–'], ['Term', r.bill?.term ?? '–'], ['Bill', r.bill?.number ?? '–'], ['Paid by', label(r.method) + (r.reference ? ` · ${r.reference}` : '')]] as const).map(([k, v]) => (
          <div key={k} className="border-b border-dotted border-ink/30 pb-0.5"><dt className="text-[10px] uppercase tracking-wide text-ink/55">{k}</dt><dd className="font-semibold">{v}</dd></div>
        ))}
      </dl>

      {r.bill && (
        <table className="mt-4 w-full border-collapse text-[12.5px]">
          <thead><tr className="bg-ink text-left text-[10.5px] uppercase tracking-wide text-white"><th className="border border-ink px-2 py-1.5">Fee</th><th className="border border-ink px-2 py-1.5 text-right">Amount</th></tr></thead>
          <tbody>
            {r.bill.items.map((i, n) => <tr key={n} className={n % 2 ? 'bg-ink/[0.04]' : ''}><td className="border border-ink/40 px-2 py-1">{i.name}</td><td className="tabular border border-ink/40 px-2 py-1 text-right">{naira(i.amount)}</td></tr>)}
            {r.bill.discount > 0 && <tr><td className="border border-ink/40 px-2 py-1">Discount{r.bill.discountReason ? ` (${r.bill.discountReason})` : ''}</td><td className="tabular border border-ink/40 px-2 py-1 text-right">-{naira(r.bill.discount)}</td></tr>}
            <tr className="font-semibold"><td className="border border-ink/40 px-2 py-1">Bill total</td><td className="tabular border border-ink/40 px-2 py-1 text-right">{naira(r.bill.payable)}</td></tr>
            <tr><td className="border border-ink/40 px-2 py-1">Paid so far (all receipts)</td><td className="tabular border border-ink/40 px-2 py-1 text-right">{naira(r.bill.paid)}</td></tr>
            <tr className="font-bold"><td className="border border-ink/40 px-2 py-1">Balance still owed</td><td className="tabular border border-ink/40 px-2 py-1 text-right">{naira(r.bill.balance)}</td></tr>
          </tbody>
        </table>
      )}

      <div className="mt-4 flex items-center justify-between rounded-md border-2 border-ink px-4 py-3">
        <span className="text-xs font-bold uppercase tracking-wide">Amount received</span>
        <span className="tabular text-2xl font-extrabold">{naira(r.amount)}</span>
      </div>
      {reversed && <p className="mt-2 text-center text-xs font-semibold uppercase text-danger">This payment was reversed{r.reversalReason ? `: ${r.reversalReason}` : ''}. It is no longer counted.</p>}

      <footer className="mt-8 grid grid-cols-2 gap-10 text-center text-[11px]">
        <div><div className="border-t border-ink/70 pt-1">Received by (bursar)</div></div>
        <div><div className="border-t border-ink/70 pt-1">School stamp</div></div>
      </footer>
      <p className="mt-4 text-center text-[10px] text-ink/50">Keep this receipt as proof of payment. Thank you.</p>
    </article>
  )
}

/** Opens the print dialog with just this receipt on the page. */
export function printReceipt(r: ReceiptData) { printSheets(<ReceiptSheet r={r} />) }
