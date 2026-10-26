/**
 * Turns a picked photo into a small square picture for a profile: cropped to the middle, shrunk to `size` pixels and saved as a JPEG,
 * so a phone photo of several megabytes becomes a few kilobytes. Throws a readable message when the file is not a usable image.
 */
export async function shrinkImage(file: File, size = 256): Promise<Blob> {
  if (!file.type.startsWith('image/')) throw new Error('Choose a picture (JPEG, PNG or WebP).')
  if (file.size > 12 * 1024 * 1024) throw new Error('That picture is too large. Choose one under 12 MB.')
  const bitmap = await createImageBitmap(file).catch(() => { throw new Error('That picture could not be read. Try another one.') })
  const side = Math.min(bitmap.width, bitmap.height)
  const canvas = document.createElement('canvas')
  canvas.width = size; canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('This browser cannot prepare pictures.')
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, size, size)
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size)
  bitmap.close()
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85))
  if (!blob) throw new Error('That picture could not be prepared. Try another one.')
  return blob
}

/** The same picture as a small text string, for demo mode (which keeps everything in the browser). */
export const blobToDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = () => reject(new Error('That picture could not be read.')); r.readAsDataURL(blob) })
