/** Money and bookkeeping for the till that has nothing to do with how it looks, kept apart so it can be tested on its own. */

const cents = (n: number) => Math.round(n * 100)
export const round2 = (n: number) => cents(n) / 100

export interface PayRow { method: string; amount: string }
export interface TillPayment { method: string; amount: number }

/**
 * What to send to the server as payments. One row left blank means the whole total in that method (the quick case). Otherwise each row that has an amount counts,
 * which is how a sale is split between, say, cash and transfer.
 */
export function paymentsOf(rows: PayRow[], total: number): TillPayment[] {
  const filled = rows.filter((r) => r.amount.trim() !== '' && Number(r.amount) > 0)
  if (!filled.length) return rows.length === 1 && total > 0 && rows[0].amount.trim() === '' ? [{ method: rows[0].method, amount: round2(total) }] : []
  return filled.map((r) => ({ method: r.method, amount: round2(Number(r.amount)) }))
}
export const paidOf = (payments: TillPayment[]) => payments.reduce((a, p) => round2(a + p.amount), 0)
/** What is still to be paid after these payments (never below zero). */
export const remainingOf = (total: number, payments: TillPayment[]) => Math.max(round2(total - paidOf(payments)), 0)
/** Change to give back when a customer hands over more cash than the cash part of the bill. */
export const changeDue = (given: number, cashDue: number) => (given > cashDue ? round2(given - cashDue) : 0)

/** The text of a receipt, for sending on WhatsApp or by email. */
export function receiptText(r: { business: string; number: string; at: string; customer?: string | null; items: { description: string; quantity: number; total: number }[]; total: number; paid: number; balance: number }, money: (n: number) => string): string {
  const lines = [`*${r.business}*`, `Receipt ${r.number}${r.customer ? ` for ${r.customer}` : ''}`, r.at.slice(0, 10), '', ...r.items.map((i) => `${i.quantity} x ${i.description}: ${money(i.total)}`), '', `Total: ${money(r.total)}`, `Paid: ${money(r.paid)}`]
  if (r.balance > 0) lines.push(`Balance due: ${money(r.balance)}`)
  lines.push('', 'Thank you for your business.')
  return lines.join('\n')
}

// ------------------------------------------------------------------ held sales
export interface HeldLine { productId: string; quantity: number; discount: number; pack: string | null }
export interface HeldSale { id: string; label: string; at: string; customerId: string; cart: HeldLine[] }
const KEY = (businessId: string) => `doa.pos.held.${businessId}`

/**
 * Sales set aside while the customer fetches something. They are kept in this browser on this device only (not in the database), so they do not appear on another phone
 * or computer, and the till says so.
 */
export function loadHeld(businessId: string): HeldSale[] {
  try { const raw = JSON.parse(localStorage.getItem(KEY(businessId)) ?? '[]') as HeldSale[]; return Array.isArray(raw) ? raw.filter((h) => h && Array.isArray(h.cart)) : [] } catch { return [] }
}
export function saveHeld(businessId: string, held: HeldSale[]) {
  try { localStorage.setItem(KEY(businessId), JSON.stringify(held.slice(0, 20))) } catch { /* storage unavailable */ }
}
export const holdLabel = (cartLength: number, at: Date, customer?: string) => `${at.toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' })} · ${cartLength} ${cartLength === 1 ? 'item' : 'items'}${customer ? ` · ${customer}` : ''}`
