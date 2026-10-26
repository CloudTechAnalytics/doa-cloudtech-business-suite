import { Camera, X } from 'lucide-react'
import { useState } from 'react'
import { resizeImage } from '@/shared/utilities/files'

/** A student's passport picture as a small round avatar, or their initials when there is no photo yet. */
export function Avatar({ name, photo, size = 'md' }: { name: string; photo?: string | null; size?: 'sm' | 'md' | 'lg' }) {
  const dim = size === 'sm' ? 'size-8 text-[11px]' : size === 'lg' ? 'size-14 text-base' : 'size-10 text-xs'
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0]).join('').toUpperCase()
  return photo ? <img src={photo} alt={`Photo of ${name}`} className={`${dim} shrink-0 rounded-full border border-line object-cover`} /> : <span aria-hidden className={`${dim} grid shrink-0 place-items-center rounded-full bg-accent-soft font-bold text-accent`}>{initials}</span>
}

/** Choose a passport photo while registering: it is shrunk to a small passport size, previewed, and saved with the student. */
export function PassportPicker({ value, onChange }: { value: string | null; onChange: (photo: string | null) => void }) {
  const [error, setError] = useState<string | null>(null)
  async function pick(f: File) {
    setError(null)
    try { let data = await resizeImage(f, 300, 400, 0.82); if (data.length > 110000) data = await resizeImage(f, 240, 320, 0.6); onChange(data) } catch (e) { setError((e as Error).message) }
  }
  return (
    <div className="flex items-center gap-4">
      <div className="h-28 w-[5.25rem] shrink-0 overflow-hidden rounded-lg border border-line bg-surface">{value ? <img src={value} alt="Passport preview" className="size-full object-cover" /> : <div className="grid size-full place-items-center text-center text-[11px] text-ink/50"><span><Camera className="mx-auto mb-1 size-5" aria-hidden />No photo</span></div>}</div>
      <div className="space-y-1.5 text-sm">
        <p className="font-semibold">Passport photo <span className="font-normal text-ink/60">(optional)</span></p>
        <p className="max-w-xs text-xs text-ink/60">Used on the ID card, report card and transcript. You can also add or change it later under the student's Documents tab.</p>
        <div className="flex flex-wrap gap-2">
          <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-line px-2.5 text-xs font-semibold hover:bg-surface">{value ? 'Change photo' : 'Choose photo'}<input type="file" accept="image/*" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) void pick(f); e.target.value = '' }} /></label>
          {value && <button type="button" onClick={() => onChange(null)} className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs text-ink/70 hover:bg-surface"><X className="size-3.5" aria-hidden /> Remove</button>}
        </div>
        {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      </div>
    </div>
  )
}
