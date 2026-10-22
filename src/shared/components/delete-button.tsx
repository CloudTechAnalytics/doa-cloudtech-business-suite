import { Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Button, ErrorState } from '@/shared/components'
import { Dialog } from '@/shared/components/dialog'
import { deleteRecord } from '@/shared/utilities/deleteRecord'
import type { DeleteKind } from '@/shared/utilities/deleteRecord'

/**
 * A Delete button with a confirmation. Only a record that was never used can be deleted; if it has history the server refuses and the
 * message says to archive it instead. The audit log keeps a note that it was deleted and by whom.
 */
export function DeleteButton({ businessId, kind, id, label, noun, onDeleted, compact = false }: {
  businessId: string; kind: DeleteKind; id: string; label: string; noun: string; onDeleted: () => void | Promise<void>; compact?: boolean
}) {
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function confirm() {
    setBusy(true); setError(null)
    const err = await deleteRecord(businessId, kind, id)
    setBusy(false)
    if (err) return setError(err)
    setAsking(false)
    await onDeleted()
  }
  return (
    <>
      <button type="button" onClick={() => { setError(null); setAsking(true) }} className={compact ? 'rounded-md px-2 py-1 text-sm font-medium text-danger hover:bg-danger-soft' : 'no-print inline-flex shrink-0 items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-sm font-medium text-danger hover:bg-danger-soft'}>
        {!compact && <Trash2 className="size-4" aria-hidden />} Delete
      </button>
      {asking && (
        <Dialog title={`Delete this ${noun}?`} onClose={() => setAsking(false)}>
          <div className="space-y-4">
            <p className="text-sm text-ink/80"><b>{label}</b> will be removed for good. This cannot be undone.</p>
            <p className="text-sm text-ink/60">A {noun} that has been used (sold, bought, stocked or recorded against) cannot be deleted, and you will be told so. In that case archive it instead.</p>
            {error && <ErrorState title="Not deleted" message={error} />}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setAsking(false)}>Cancel</Button>
              <Button type="button" loading={busy} onClick={() => void confirm()} className="bg-danger text-white hover:bg-danger/90">Delete</Button>
            </div>
          </div>
        </Dialog>
      )}
    </>
  )
}
