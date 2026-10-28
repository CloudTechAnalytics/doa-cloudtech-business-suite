import { Camera, ImageOff, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '@/shared/components'
import { Dialog } from '@/shared/components/dialog'
import { resizeImage } from '@/shared/utilities/files'
import { loadProductImage } from './productPictures'
import type { ProductPicture } from './productPictures'

const THUMB_LIMIT = 28000, IMAGE_LIMIT = 190000

/** Shrinks a chosen photo into the two sizes the database keeps, trying smaller and plainer until each fits. */
export async function makePicture(file: File): Promise<ProductPicture> {
  let thumb = ''; let image = ''
  for (const [w, q] of [[160, 0.72], [128, 0.6], [96, 0.5]] as const) { thumb = await resizeImage(file, w, w, q); if (thumb.length <= THUMB_LIMIT) break }
  for (const [w, q] of [[900, 0.8], [720, 0.7], [560, 0.6], [420, 0.5]] as const) { image = await resizeImage(file, w, w, q); if (image.length <= IMAGE_LIMIT) break }
  if (thumb.length > THUMB_LIMIT || image.length > IMAGE_LIMIT) throw new Error('That picture is too detailed to keep. Try a simpler or smaller one.')
  return { thumb, image }
}

/** A product's small picture, or its first letter when it has none. Click it (when it has a picture) to see it bigger. */
export function ProductThumb({ name, thumb, size = 'md', onClick }: { name: string; thumb?: string | null; size?: 'sm' | 'md' | 'lg'; onClick?: () => void }) {
  const dim = size === 'sm' ? 'size-9' : size === 'lg' ? 'h-20 w-full' : 'size-12'
  const body = thumb
    ? <img src={thumb} alt={name} className={`${dim} rounded-md border border-line object-cover`} />
    : <span aria-hidden className={`${dim} grid shrink-0 place-items-center rounded-md bg-accent-soft text-sm font-bold text-ink/60`}>{name.trim().slice(0, 1).toUpperCase() || '?'}</span>
  return onClick && thumb ? <button type="button" onClick={(e) => { e.stopPropagation(); onClick() }} aria-label={`Show a bigger picture of ${name}`} className="shrink-0 cursor-zoom-in rounded-md">{body}</button> : body
}

/** The larger picture of a product, in a window of its own. */
export function PictureViewer({ productId, name, onClose }: { productId: string; name: string; onClose: () => void }) {
  const [image, setImage] = useState<string | null | undefined>(undefined)
  useEffect(() => { let on = true; void loadProductImage(productId).then((x) => { if (on) setImage(x) }); return () => { on = false } }, [productId])
  return (
    <Dialog title={name} onClose={onClose} wide>
      {image === undefined ? <p className="py-10 text-center text-sm text-ink/60">Loading the picture…</p>
        : image ? <img src={image} alt={name} className="mx-auto max-h-[70vh] w-auto max-w-full rounded-lg" />
        : <p className="flex items-center justify-center gap-2 py-10 text-sm text-ink/60"><ImageOff className="size-4" aria-hidden /> No picture yet.</p>}
    </Dialog>
  )
}

/** Choose, change or remove a product's picture. `picture` is what will be saved: undefined keeps what the product has, null removes it. */
export function PictureField({ name, current, picture, onChange }: { name: string; current?: string | null; picture: ProductPicture | null | undefined; onChange: (p: ProductPicture | null | undefined) => void }) {
  const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false)
  const shown = picture === undefined ? current : picture?.thumb ?? null
  async function pick(f: File) { setError(null); setBusy(true); try { onChange(await makePicture(f)) } catch (e) { setError((e as Error).message) } finally { setBusy(false) } }
  return (
    <div className="flex items-center gap-4">
      <div className="size-20 shrink-0 overflow-hidden rounded-lg border border-line bg-surface">{shown ? <img src={shown} alt={`Picture of ${name || 'the product'}`} className="size-full object-cover" /> : <span className="grid size-full place-items-center text-ink/40"><Camera className="size-6" aria-hidden /></span>}</div>
      <div className="space-y-1.5 text-sm">
        <p className="font-semibold">Picture <span className="font-normal text-ink/60">(optional)</span></p>
        <p className="max-w-sm text-xs text-ink/60">Shown on the till and in lists so the product is easy to spot. Click it in a list to see it bigger.</p>
        <div className="flex flex-wrap gap-2">
          <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-line px-2.5 text-xs font-semibold hover:bg-surface">{busy ? 'Preparing…' : shown ? 'Change picture' : 'Choose picture'}<input type="file" accept="image/*" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) void pick(f); e.target.value = '' }} /></label>
          {shown && <Button type="button" variant="ghost" onClick={() => onChange(null)}><X className="size-3.5" aria-hidden /> Remove</Button>}
        </div>
        {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      </div>
    </div>
  )
}
