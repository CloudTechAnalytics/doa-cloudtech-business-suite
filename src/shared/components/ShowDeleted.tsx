/** A small switch under a list: deleted records are hidden, and this shows them again (they are kept for the record, faded). Nothing shows when there are none. */
export function ShowDeleted({ count, show, onChange }: { count: number; show: boolean; onChange: (show: boolean) => void }) {
  if (count === 0) return null
  return (
    <button type="button" onClick={() => onChange(!show)} className="mt-2 text-xs text-ink/60 underline hover:text-ink">
      {show ? 'Hide deleted records' : `Show deleted records (${count})`}
    </button>
  )
}

/** A new key for a one-off delete, so retrying a delete that already went through does nothing twice. */
export const deleteKey = () => crypto.randomUUID()
