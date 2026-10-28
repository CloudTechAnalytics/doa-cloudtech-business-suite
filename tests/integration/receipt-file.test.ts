import { describe, expect, it } from 'vitest'
import { receiptModel, pdfFromJpeg } from '@/modules/sales/receiptFile'
import type { ReceiptLine } from '@/modules/sales/receiptFile'
import type { ReceiptData } from '@/modules/sales/tradeApi'
import { dateTime, naira, qty } from '@/shared/utilities/format'

const base = (): ReceiptData => ({
  business: { name: 'Test Mart', currency: 'NGN', address: '12 Market Road, Ikeja', phone: '0803 111 2222', footer: 'Goods sold are not returnable.' },
  cashier: 'Ada Cashier', tender: { tendered: 1000, change: 32.5 },
  sale: { sale_number: 'SAL-000007', sold_at: '2026-10-28T10:48:00Z', subtotal: 900, discount_total: 0, tax_total: 67.5, grand_total: 967.5, amount_paid: 967.5, balance_due: 0, status: 'posted' },
  customer: null,
  items: [{ description: 'Cola 500ml', quantity: 3, unit_price: 300, discount: 0, tax: 67.5, total: 967.5 }],
  payments: [{ method: 'cash', amount: 967.5, status: 'successful', type: 'sale_receipt', at: '2026-10-28T10:48:00Z' }],
})
const lines = (d: ReceiptData) => receiptModel(d, naira, qty, dateTime)
const text = (ls: ReceiptLine[]) => ls.map((l) => ('text' in l ? l.text : 'left' in l ? `${l.left} | ${l.right}` : l.kind === 'rule' ? '---' : '')).join('\n')

describe('what a receipt says', () => {
  it('names the shop, where it is and how to reach it, then the sale, the date and who served', () => {
    const t = text(lines(base()))
    expect(t).toContain('Test Mart'); expect(t).toContain('12 Market Road, Ikeja'); expect(t).toContain('Tel: 0803 111 2222')
    expect(t).toContain('Receipt SAL-000007'); expect(t).toContain('Served by Ada Cashier')
  })
  it('lists each item with its quantity, price and tax, and the totals in order', () => {
    const t = text(lines(base()))
    expect(t).toContain('Cola 500ml | ₦967.50'); expect(t).toContain('3 × ₦300.00  +tax ₦67.50')
    expect(t.indexOf('Subtotal')).toBeLessThan(t.indexOf('Tax')); expect(t.indexOf('Tax')).toBeLessThan(t.indexOf('TOTAL'))
    expect(t).toContain('TOTAL | ₦967.50')
  })
  it('shows the cash given and the change after the payment, and nothing about them when it was not recorded', () => {
    const t = text(lines(base()))
    expect(t).toContain('Paid (Cash) | ₦967.50'); expect(t).toContain('Cash given | ₦1,000.00'); expect(t).toContain('Change | ₦32.50')
    expect(t.indexOf('Paid (Cash)')).toBeLessThan(t.indexOf('Cash given'))
    const d = base(); d.tender = null
    expect(text(lines(d))).not.toMatch(/Cash given|Change/)
  })
  it('shows a discount, a balance still owed and a refund, writes POS as POS, and leaves out what is not there', () => {
    const d = base(); d.sale.discount_total = 50; d.sale.balance_due = 100; d.tender = null; d.business = { name: 'Plain Shop', currency: 'NGN' }; d.cashier = null
    d.payments = [{ method: 'pos', amount: 800, status: 'successful', type: 'sale_receipt', at: '' }, { method: 'cash', amount: 20, status: 'successful', type: 'refund', at: '' }, { method: 'card', amount: 5, status: 'pending', type: 'sale_receipt', at: '' }]
    const t = text(lines(d))
    expect(t).toContain('Discount | −₦50.00'); expect(t).toContain('Balance due | ₦100.00'); expect(t).toContain('Paid (POS) | ₦800.00'); expect(t).toContain('Refund (Cash) | −₦20.00')
    expect(t).not.toContain('Card'); expect(t).not.toContain('Tel:'); expect(t).not.toContain('Served by')
  })
  it('closes with the shop\'s own line, or a thank-you when it has none', () => {
    expect(text(lines(base())).trim().endsWith('Goods sold are not returnable.')).toBe(true)
    const d = base(); d.business.footer = null
    expect(text(lines(d)).trim().endsWith('Thank you for your business.')).toBe(true)
  })
})

describe('the receipt as a PDF file', () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0xff, 0xd9])
  const pdf = pdfFromJpeg(jpeg, 560, 900)
  const s = new TextDecoder('latin1').decode(pdf)
  it('is a PDF that starts and ends the way a PDF does, 80 mm wide with the receipt\'s proportions', () => {
    expect(s.startsWith('%PDF-1.4')).toBe(true); expect(s.trimEnd().endsWith('%%EOF')).toBe(true)
    const box = /MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(s)!
    expect(Number(box[1])).toBeCloseTo(226.77, 2); expect(Number(box[2]) / Number(box[1])).toBeCloseTo(900 / 560, 2)
  })
  it('has its objects where its table of contents says they are, so any viewer can open it', () => {
    const start = Number(/startxref\n(\d+)\n/.exec(s)![1])
    expect(s.slice(start, start + 4)).toBe('xref')
    const entries = [...s.slice(start).matchAll(/(\d{10}) 00000 n /g)].map((m) => Number(m[1]))
    expect(entries).toHaveLength(5)
    entries.forEach((off, i) => expect(s.slice(off, off + 7)).toBe(`${i + 1} 0 obj`))
  })
  it('carries the picture itself, untouched, with its true length', () => {
    const len = Number(/\/DCTDecode \/Length (\d+)/.exec(s)![1])
    expect(len).toBe(jpeg.length)
    const at = s.indexOf('stream\n', s.indexOf('/DCTDecode')) + 7
    expect([...pdf.slice(at, at + len)]).toEqual([...jpeg])
  })
})
