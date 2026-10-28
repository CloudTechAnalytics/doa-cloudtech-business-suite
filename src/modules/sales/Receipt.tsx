import { Download, FileText, MessageCircle, Printer } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button, ErrorState, Spinner } from '@/shared/components'
import { Dialog } from '@/shared/components/dialog'
import { useAsync } from '@/shared/hooks/useAsync'
import { dateTime, naira, qty } from '@/shared/utilities/format'
import { receiptData } from '@/modules/sales/tradeApi'
import { canvasToBlob, drawReceipt, receiptModel, receiptPdf, shareOrSave } from '@/modules/sales/receiptFile'
import type { ReceiptLine } from '@/modules/sales/receiptFile'
import { receiptText } from '@/modules/sales/till'
import { whatsappUrl } from '@/shared/utilities/contact'

/** Can this browser hand a file to the phone's share sheet (where WhatsApp is a choice)? True on most phones, usually false on a computer. */
const canShareFiles = () => { try { const n = navigator as Navigator & { canShare?: (d: ShareData) => boolean }; return typeof n.canShare === 'function' && n.canShare({ files: [new File([''], 'r.png', { type: 'image/png' })] }) } catch { return false } }

/** The receipt of a sale: shown, printed, saved as a picture or a PDF, or sent on WhatsApp. Figures come from the database record, not the browser cart. */
export function ReceiptDialog({ businessId, saleId, onClose }: { businessId: string; saleId: string; onClose: () => void }) {
  const { data, error, loading } = useAsync(() => receiptData(businessId, saleId), [businessId, saleId])
  const [phone, setPhone] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null); const [note, setNote] = useState<string | null>(null); const [problem, setProblem] = useState<string | null>(null)
  const lines = useMemo(() => (data ? receiptModel(data, naira, qty, dateTime) : []), [data])
  const share = canShareFiles()
  const number = phone ?? data?.customer?.phone ?? ''
  const file = data?.sale.sale_number ?? 'receipt'
  const text = data ? receiptText({ business: data.business.name, number: data.sale.sale_number, at: data.sale.sold_at, customer: data.customer?.name, items: data.items.map((i) => ({ description: i.description, quantity: i.quantity, total: i.total })), total: data.sale.grand_total, paid: data.sale.amount_paid, balance: data.sale.balance_due }, naira) : ''

  async function act(name: string, fn: () => Promise<void>) {
    setBusy(name); setNote(null); setProblem(null)
    try { await fn() } catch (e) { setProblem((e as Error).message) } finally { setBusy(null) }
  }
  const sendWhatsapp = () => act('whatsapp', async () => {
    const blob = await canvasToBlob(drawReceipt(lines), 'image/png')
    const r = await shareOrSave(blob, `${file}.png`, text)
    if (r === 'downloaded') {
      if (number) window.open(whatsappUrl(number, text), '_blank', 'noopener')
      setNote(number ? 'This computer cannot attach a file to WhatsApp by itself, so the receipt picture was saved. WhatsApp is opening with the receipt text; attach the saved picture if you want it as an image.' : 'The receipt picture was saved. Enter the customer\'s number to open WhatsApp with the receipt text, or attach the saved picture yourself.')
    }
  })
  const savePdf = () => act('pdf', async () => { await shareOrSave(await receiptPdf(drawReceipt(lines)), `${file}.pdf`, text) })
  const savePng = () => act('png', async () => { await shareOrSave(await canvasToBlob(drawReceipt(lines), 'image/png'), `${file}.png`, text) })

  return (
    <Dialog title="Receipt" onClose={onClose}>
      {loading && <Spinner />}
      {error && <ErrorState message={error} />}
      {data && (
        <>
          <div className="receipt-print mx-auto w-full max-w-[20rem] rounded-md border border-dashed border-ink/25 bg-white px-4 py-5 text-[13px] leading-snug text-ink">
            {lines.map((l, i) => <Line key={i} l={l} />)}
          </div>
          <div className="no-print mt-4 space-y-3">
            <div className="flex flex-wrap items-end justify-end gap-2">
              <label className="mr-auto text-xs text-ink/70">Customer's WhatsApp number
                <input aria-label="Customer's WhatsApp number" value={number} onChange={(e) => setPhone(e.target.value)} placeholder="0803 123 4567" className="mt-1 block w-44 rounded-md border border-line px-2 py-1.5 text-sm" />
              </label>
              <Button variant="secondary" onClick={() => void savePng()} loading={busy === 'png'}><Download className="size-4" aria-hidden /> Picture</Button>
              <Button variant="secondary" onClick={() => void savePdf()} loading={busy === 'pdf'}><FileText className="size-4" aria-hidden /> PDF</Button>
              <Button variant="secondary" onClick={() => window.print()}><Printer className="size-4" aria-hidden /> Print</Button>
              <Button onClick={() => void sendWhatsapp()} loading={busy === 'whatsapp'}><MessageCircle className="size-4" aria-hidden /> Send on WhatsApp</Button>
            </div>
            <p className="text-xs text-ink/60">{share ? 'Send on WhatsApp opens the share sheet of this device with the receipt as a picture. Choose WhatsApp, then the customer. Picture and PDF save the file.' : 'Picture and PDF are saved to this device. Send on WhatsApp saves the picture and opens WhatsApp with the receipt text for the number above, because a computer cannot attach files to WhatsApp by itself.'}</p>
            {note && <p role="status" className="rounded-md bg-surface p-2 text-xs text-ink/80">{note}</p>}
            {problem && <ErrorState title="Not done" message={problem} />}
          </div>
        </>
      )}
    </Dialog>
  )
}

/** One line of the receipt, drawn the way the picture draws it. */
function Line({ l }: { l: ReceiptLine }) {
  switch (l.kind) {
    case 'title': return <p className="text-center text-lg font-bold">{l.text}</p>
    case 'strong': return <p className="text-center font-semibold">{l.text}</p>
    case 'small': return <p className="text-center text-xs text-ink/65">{l.text}</p>
    case 'footer': return <p className="pt-1 text-center text-xs text-ink/65">{l.text}</p>
    case 'text': return <p className="text-center">{l.text}</p>
    case 'detail': return <p className="mb-1 pl-3 text-xs text-ink/60">{l.text}</p>
    case 'rule': return <hr className="my-2 border-t border-dashed border-ink/30" />
    case 'gap': return <div className="h-2" />
    case 'item': return <div className="flex justify-between gap-3 font-semibold"><span className="min-w-0 break-words">{l.left}</span><span className="tabular shrink-0">{l.right}</span></div>
    case 'rowStrong': return <div className="flex justify-between gap-3 py-0.5 text-base font-bold"><span>{l.left}</span><span className="tabular">{l.right}</span></div>
    default: return <div className="flex justify-between gap-3"><span>{l.left}</span><span className="tabular">{l.right}</span></div>
  }
}
