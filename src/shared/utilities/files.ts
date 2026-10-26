/** Reads a chosen file as a data URL (the file's bytes as text the database can keep). */
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(new Error('The file could not be read.'))
    r.readAsDataURL(file)
  })
}

/** Shrinks a picture to fit inside maxWidth x maxHeight and saves it as a JPEG, so a phone photo of several MB becomes a few tens of KB. */
export async function resizeImage(file: File, maxWidth: number, maxHeight: number, quality = 0.82): Promise<string> {
  const url = await fileToDataUrl(file)
  const img = await new Promise<HTMLImageElement>((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = () => reject(new Error('That does not look like a picture.')); i.src = url })
  const scale = Math.min(1, maxWidth / img.width, maxHeight / img.height)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(img.width * scale)); canvas.height = Math.max(1, Math.round(img.height * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Pictures cannot be processed in this browser.')
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', quality)
}

/** Opens a stored file (a data URL) in a new tab without putting its bytes in the address bar. */
export function openDataUrl(dataUrl: string) {
  const [meta, body] = dataUrl.split(',')
  const mime = /data:([^;]+)/.exec(meta)?.[1] ?? 'application/octet-stream'
  const bytes = Uint8Array.from(atob(body), (c) => c.charCodeAt(0))
  window.open(URL.createObjectURL(new Blob([bytes], { type: mime })), '_blank', 'noopener')
}
