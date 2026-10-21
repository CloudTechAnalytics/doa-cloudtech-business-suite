import { Plus, X } from 'lucide-react'
import { Button, SelectField, TextField } from '@/shared/components'

export interface EditorLine { productId: string; quantity: string; cost: string }
export const blankLine = (): EditorLine => ({ productId: '', quantity: '', cost: '' })

/** Product / quantity (/ cost) rows for request and order forms. A product can appear once, so taken ones are hidden from other rows. */
export function LinesEditor({ lines, setLines, products, costLabel }: {
  lines: EditorLine[]
  setLines: (next: EditorLine[]) => void
  products: { id: string; name: string; unit: string; defaultCost?: number | null }[]
  /** Show a cost column with this label (e.g. "Estimated cost"). */
  costLabel?: string
}) {
  const set = (i: number, patch: Partial<EditorLine>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)))
  const cols = costLabel ? 'sm:grid-cols-[1fr_100px_130px_auto]' : 'sm:grid-cols-[1fr_120px_auto]'
  return (
    <div className="space-y-2">
      {lines.map((l, i) => (
        <div key={i} className={`grid items-end gap-2 ${cols}`}>
          <SelectField label={i === 0 ? 'Product' : ' '} value={l.productId} onChange={(e) => {
            const p = products.find((x) => x.id === e.target.value)
            set(i, { productId: e.target.value, cost: l.cost || (p?.defaultCost != null ? String(p.defaultCost) : '') })
          }}>
            <option value="">Select…</option>
            {products.filter((p) => p.id === l.productId || !lines.some((x) => x.productId === p.id)).map((p) => <option key={p.id} value={p.id}>{p.name} ({p.unit})</option>)}
          </SelectField>
          <TextField label={i === 0 ? 'Quantity' : ' '} type="number" step="any" min="0" value={l.quantity} onChange={(e) => set(i, { quantity: e.target.value })} />
          {costLabel && <TextField label={i === 0 ? costLabel : ' '} type="number" step="0.01" min="0" value={l.cost} onChange={(e) => set(i, { cost: e.target.value })} />}
          <button type="button" aria-label="Remove line" disabled={lines.length === 1} onClick={() => setLines(lines.filter((_, j) => j !== i))} className="mb-2 p-2 text-ink/50 hover:text-danger disabled:opacity-30"><X className="size-4" aria-hidden /></button>
        </div>
      ))}
      <Button type="button" variant="ghost" onClick={() => setLines([...lines, blankLine()])}><Plus className="size-4" aria-hidden /> Add line</Button>
    </div>
  )
}
