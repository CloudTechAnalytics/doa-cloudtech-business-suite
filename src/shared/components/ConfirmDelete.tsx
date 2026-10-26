import { Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Button, ErrorState, TextField } from '@/shared/components'
import { Dialog } from '@/shared/components/dialog'

/**
 * A Delete button that asks first: it says what will be removed, can ask for a reason (kept in the audit trail), and shows the server's refusal in plain words
 * (for example "this student has fee payments on record"). `onConfirm` returns an error message, or null when it worked.
 */
export function ConfirmDelete({ label, noun, warning, withReason = false, compact = false, onConfirm, onDeleted }: {
  label: string; noun: string; warning: string; withReason?: boolean; compact?: boolean
  onConfirm: (reason: string) => Promise<string | null>; onDeleted: () => void | Promise<void>
}) {
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  async function confirm() {
    setBusy(true); setError(null)
    const err = await onConfirm(reason)
    setBusy(false)
    if (err) return setError(err)
    setAsking(false)
    await onDeleted()
  }
  return (
    <>
      <button type="button" onClick={() => { setError(null); setReason(''); setAsking(true) }} className={compact ? 'rounded-md px-2 py-1 text-sm font-medium text-danger hover:bg-danger-soft' : 'no-print inline-flex shrink-0 items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-sm font-medium text-danger hover:bg-danger-soft'}>
        {!compact && <Trash2 className="size-4" aria-hidden />} Delete
      </button>
      {asking && (
        <Dialog title={`Delete this ${noun}?`} onClose={() => setAsking(false)}>
          <div className="space-y-4">
            <p className="text-sm text-ink/80"><b>{label}</b> will be removed for good. This cannot be undone.</p>
            <p className="text-sm text-ink/60">{warning}</p>
            {withReason && <TextField label="Reason (kept in the audit trail)" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />}
            {error && <ErrorState title="Not deleted" message={error} />}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setAsking(false)}>Cancel</Button>
              <Button type="button" loading={busy} disabled={withReason && reason.trim().length < 3} onClick={() => void confirm()} className="bg-danger text-white hover:bg-danger/90">Delete</Button>
            </div>
          </div>
        </Dialog>
      )}
    </>
  )
}
