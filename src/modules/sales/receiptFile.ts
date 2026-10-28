import type { ReceiptData } from '@/modules/sales/tradeApi'

/**
 * A receipt as a picture and as a PDF file, so it can be sent on WhatsApp or kept. The same lines are used for the picture, the on-screen receipt and the
 * tests, so what is sent is what was seen. Nothing here leaves the browser: sending is the person's own choice in their phone's share sheet.
 */
export type ReceiptLine =
  | { kind: 'title' | 'text' | 'small' | 'strong' | 'footer'; text: string }
  | { kind: 'row' | 'rowStrong' | 'item'; left: string; right: string }
  | { kind: 'detail'; text: string }
  | { kind: 'rule' }
  | { kind: 'gap' }

const methodWord = (m: string) => (m === 'pos' ? 'POS' : m.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()))

export function receiptModel(d: ReceiptData, money: (n: number) => string, qty: (n: number) => string, when: (iso: string) => string): ReceiptLine[] {
  const out: ReceiptLine[] = []
  out.push({ kind: 'title', text: d.business.name })
  if (d.business.address) out.push({ kind: 'small', text: d.business.address })
  if (d.business.phone) out.push({ kind: 'small', text: `Tel: ${d.business.phone}` })
  out.push({ kind: 'rule' })
  out.push({ kind: 'strong', text: `Receipt ${d.sale.sale_number}` })
  out.push({ kind: 'small', text: when(d.sale.sold_at) })
  if (d.cashier) out.push({ kind: 'small', text: `Served by ${d.cashier}` })
  if (d.customer) out.push({ kind: 'small', text: `Customer: ${d.customer.name}` })
  out.push({ kind: 'rule' })
  for (const i of d.items) {
    out.push({ kind: 'item', left: i.description, right: money(i.total) })
    out.push({ kind: 'detail', text: `${qty(i.quantity)} × ${money(i.unit_price)}${i.discount > 0 ? `  (−${money(i.discount)})` : ''}${i.tax > 0 ? `  +tax ${money(i.tax)}` : ''}` })
  }
  out.push({ kind: 'rule' })
  out.push({ kind: 'row', left: 'Subtotal', right: money(d.sale.subtotal) })
  if (d.sale.discount_total > 0) out.push({ kind: 'row', left: 'Discount', right: `−${money(d.sale.discount_total)}` })
  if (d.sale.tax_total > 0) out.push({ kind: 'row', left: 'Tax', right: money(d.sale.tax_total) })
  out.push({ kind: 'rowStrong', left: 'TOTAL', right: money(d.sale.grand_total) })
  out.push({ kind: 'gap' })
  for (const p of d.payments.filter((x) => x.status === 'successful')) {
    out.push({ kind: 'row', left: `${p.type === 'refund' ? 'Refund' : 'Paid'} (${methodWord(p.method)})`, right: `${p.type === 'refund' ? '−' : ''}${money(p.amount)}` })
  }
  if (d.tender) {
    out.push({ kind: 'row', left: 'Cash given', right: money(d.tender.tendered) })
    out.push({ kind: 'row', left: 'Change', right: money(d.tender.change) })
  }
  if (d.sale.balance_due > 0) out.push({ kind: 'rowStrong', left: 'Balance due', right: money(d.sale.balance_due) })
  out.push({ kind: 'rule' })
  out.push({ kind: 'footer', text: d.business.footer || 'Thank you for your business.' })
  return out
}

// ----------------------------------------------------------------------- picture
const WIDTH = 560, PAD = 32

/** Draws the lines on a canvas, 560 px wide (an 80 mm till roll at a sharp resolution), as tall as it needs to be. */
export function drawReceipt(lines: ReceiptLine[]): HTMLCanvasElement {
  const canvas = document.createElement('canvas'); canvas.width = WIDTH
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Pictures cannot be made in this browser.')
  const font = (px: number, bold = false) => `${bold ? '700 ' : '400 '}${px}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`
  const gap = (l: ReceiptLine) => (l.kind === 'title' ? 46 : l.kind === 'rule' ? 22 : l.kind === 'gap' ? 14 : l.kind === 'rowStrong' ? 36 : l.kind === 'detail' ? 26 : l.kind === 'small' ? 26 : 30)
  canvas.height = PAD * 2 + lines.reduce((a, l) => a + gap(l), 0)
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height)
  let y = PAD
  const fit = (text: string, max: number, px: number, bold = false) => { ctx.font = font(px, bold); let t = text; while (t.length > 1 && ctx.measureText(t).width > max) t = t.slice(0, -2) + '…'; return t }
  for (const l of lines) {
    const h = gap(l); const base = y + h - 8
    if (l.kind === 'rule') { ctx.strokeStyle = '#9ca3af'; ctx.setLineDash([6, 5]); ctx.beginPath(); ctx.moveTo(PAD, y + h / 2); ctx.lineTo(WIDTH - PAD, y + h / 2); ctx.stroke(); ctx.setLineDash([]) }
    else if (l.kind === 'gap') { /* space only */ }
    else if (l.kind === 'row' || l.kind === 'rowStrong' || l.kind === 'item') {
      const bold = l.kind !== 'row'; const px = l.kind === 'rowStrong' ? 26 : 19
      ctx.fillStyle = '#111827'; ctx.font = font(px, bold); const rw = ctx.measureText(l.right).width
      ctx.textAlign = 'right'; ctx.fillText(l.right, WIDTH - PAD, base); ctx.textAlign = 'left'
      ctx.fillText(fit(l.left, WIDTH - PAD * 2 - rw - 16, px, bold), PAD, base)
    } else if ('text' in l) {
      const px = l.kind === 'title' ? 30 : l.kind === 'strong' ? 21 : l.kind === 'detail' ? 16 : l.kind === 'small' ? 17 : l.kind === 'footer' ? 18 : 19
      ctx.fillStyle = l.kind === 'small' || l.kind === 'detail' || l.kind === 'footer' ? '#4b5563' : '#111827'
      ctx.font = font(px, l.kind === 'title' || l.kind === 'strong')
      ctx.textAlign = l.kind === 'detail' ? 'left' : 'center'
      const text = fit(l.text, WIDTH - PAD * 2, px, l.kind === 'title' || l.kind === 'strong')
      ctx.fillText(text, l.kind === 'detail' ? PAD + 12 : WIDTH / 2, base); ctx.textAlign = 'left'
    }
    y += h
  }
  return canvas
}

export const canvasToBlob = (c: HTMLCanvasElement, type: 'image/png' | 'image/jpeg', quality = 0.92) => new Promise<Blob>((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('The picture could not be made.'))), type, quality))

// --------------------------------------------------------------------------- PDF
/** A one-page PDF whose page is the receipt picture (JPEG bytes), 80 mm wide. A real PDF file, readable by any viewer, with no library. */
export function pdfFromJpeg(jpeg: Uint8Array, widthPx: number, heightPx: number): Uint8Array {
  const W = 226.77, H = Math.round((heightPx / widthPx) * W * 100) / 100
  const enc = new TextEncoder()
  const parts: Uint8Array[] = []; const offsets: number[] = []; let size = 0
  const push = (b: Uint8Array | string) => { const u = typeof b === 'string' ? enc.encode(b) : b; parts.push(u); size += u.length }
  const obj = (n: number, body: string) => { offsets[n] = size; push(`${n} 0 obj\n${body}\nendobj\n`) }
  push('%PDF-1.4\n%âãÏÓ\n')
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>')
  obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>')
  obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Contents 4 0 R /Resources << /XObject << /Im0 5 0 R >> >> >>`)
  const content = `q ${W} 0 0 ${H} 0 0 cm /Im0 Do Q`
  obj(4, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`)
  offsets[5] = size
  push(`5 0 obj\n<< /Type /XObject /Subtype /Image /Width ${widthPx} /Height ${heightPx} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`)
  push(jpeg); push('\nendstream\nendobj\n')
  const xref = size
  push(`xref\n0 6\n0000000000 65535 f \n${[1, 2, 3, 4, 5].map((n) => `${String(offsets[n]).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`)
  const out = new Uint8Array(size); let at = 0
  for (const p of parts) { out.set(p, at); at += p.length }
  return out
}

export async function receiptPdf(canvas: HTMLCanvasElement): Promise<Blob> {
  const jpeg = new Uint8Array(await (await canvasToBlob(canvas, 'image/jpeg', 0.9)).arrayBuffer())
  return new Blob([pdfFromJpeg(jpeg, canvas.width, canvas.height) as BlobPart], { type: 'application/pdf' })
}

// -------------------------------------------------------------------------- send
export type SendResult = 'shared' | 'downloaded' | 'cancelled'

/** Hands the file to the phone's share sheet (where WhatsApp is one of the choices) when the browser can; otherwise saves it, so it can be attached by hand. */
export async function shareOrSave(blob: Blob, filename: string, text: string): Promise<SendResult> {
  const file = new File([blob], filename, { type: blob.type })
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean }
  if (typeof nav.share === 'function' && typeof nav.canShare === 'function' && nav.canShare({ files: [file] })) {
    try { await nav.share({ files: [file], text, title: filename }); return 'shared' } catch (e) { if ((e as Error).name === 'AbortError') return 'cancelled' }
  }
  const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
  return 'downloaded'
}
