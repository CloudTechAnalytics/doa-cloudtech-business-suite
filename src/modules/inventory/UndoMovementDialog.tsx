import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Button, ErrorState, Notice, TextField } from '@/shared/components'
import { Dialog } from '@/shared/components/dialog'
import { reverse } from './inventoryApi'

/** What the person is told when the database refuses to undo an entry: plain words instead of a stock error. */
export function undoMessage(error: string): string {
  const m = /insufficient stock: ([\d.]+) on hand, ([\d.]+) requested/i.exec(error)
  if (m) return `Some of this stock has already been sold or written off, so it cannot all be taken back (${Number(m[1])} left, ${Number(m[2])} to remove). Use a stock count or record a loss for the difference instead.`
  return error
}

/**
 * Takes back a stock movement made by mistake (a delivery entered twice, the wrong quantity). The reason is kept with the reversal; the original line stays in the
 * history marked as reversed, so nothing is erased. The database refuses it when the stock has since been sold.
 */
export function UndoMovementDialog({ businessId, movementId, summary, onClose, onDone }: { businessId: string; movementId: string; summary: string; onClose: () => void; onDone: () => Promise<void> }) {
  const key = useRef(crypto.randomUUID())
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null)
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const reason = String(new FormData(e.currentTarget).get('reason') ?? '').trim()
    if (reason.length < 3) return setError('Say why, in a few words.')
    setBusy(true); setError(null)
    const err = await reverse(businessId, movementId, reason, key.current)
    setBusy(false)
    if (err) return setError(undoMessage(err))
    await onDone()
  }
  return (
    <Dialog title="Undo this stock entry" onClose={onClose}>
      <form onSubmit={submit} noValidate className="space-y-3">
        <p className="text-sm"><b>{summary}</b></p>
        <Notice>The stock goes back to what it was. The entry stays in the history marked as reversed, with your reason.</Notice>
        <TextField label="Why are you undoing it?" name="reason" placeholder="e.g. Entered twice by mistake" autoFocus />
        {error && <ErrorState title="Not undone" message={error} />}
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={busy}>Undo entry</Button></div>
      </form>
    </Dialog>
  )
}
