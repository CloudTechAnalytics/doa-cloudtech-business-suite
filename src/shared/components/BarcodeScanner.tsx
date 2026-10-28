import { Camera } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/shared/components'
import { Dialog } from '@/shared/components/dialog'

interface Detector { detect(source: CanvasImageSource): Promise<{ rawValue: string }[]> }
interface DetectorCtor { new (opts?: { formats?: string[] }): Detector; getSupportedFormats?: () => Promise<string[]> }
const ctor = (): DetectorCtor | null => (typeof window !== 'undefined' ? ((window as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector ?? null) : null)

/** Can this browser read barcodes and QR codes through the camera? True in Chrome on Android and some other browsers; a USB or Bluetooth scanner works everywhere. */
export const cameraScanSupported = () => !!ctor() && typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia

/** The code printed on a product, which can be a barcode or a QR code, trimmed. A QR code that holds a web address is matched by its last part, where a code usually sits. */
export function codeFrom(raw: string): string[] {
  const t = raw.trim()
  const out = [t]
  try { const u = new URL(t); const last = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() ?? ''); const q = u.searchParams.get('code') ?? u.searchParams.get('sku') ?? u.searchParams.get('barcode'); for (const x of [q, last]) if (x && !out.includes(x)) out.push(x) } catch { /* not an address */ }
  return out
}

/** Points the camera at a product's own barcode or QR code and hands back what it reads. Stops the camera when it has a code or is closed. */
export function BarcodeScanDialog({ onScan, onClose, title = 'Scan a product code' }: { onScan: (code: string) => void; onClose: () => void; title?: string }) {
  const video = useRef<HTMLVideoElement>(null)
  const [problem, setProblem] = useState<string | null>(null)
  useEffect(() => {
    let stream: MediaStream | null = null; let stopped = false; let timer = 0
    async function start() {
      const Detector = ctor()
      if (!Detector) return setProblem('This browser cannot read codes with the camera. A USB or Bluetooth barcode scanner works here: click the box and scan.')
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
        if (stopped || !video.current) return
        video.current.srcObject = stream; await video.current.play()
        const supported = (await Detector.getSupportedFormats?.()) ?? []
        const wanted = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'qr_code', 'data_matrix'].filter((f) => !supported.length || supported.includes(f))
        const detector = new Detector({ formats: wanted })
        const tick = async () => {
          if (stopped || !video.current) return
          try { const found = await detector.detect(video.current); if (found[0]?.rawValue) { stopped = true; stream?.getTracks().forEach((t) => t.stop()); onScan(found[0].rawValue); return } } catch { /* a frame that could not be read */ }
          timer = window.setTimeout(() => void tick(), 220)
        }
        void tick()
      } catch (e) {
        setProblem((e as Error).name === 'NotAllowedError' ? 'The camera is blocked. Allow the camera for this site in your browser, then try again.' : 'The camera could not be started on this device.')
      }
    }
    void start()
    return () => { stopped = true; window.clearTimeout(timer); stream?.getTracks().forEach((t) => t.stop()) }
  }, [onScan])
  return (
    <Dialog title={title} onClose={onClose}>
      <div className="space-y-3">
        {problem ? <p role="alert" className="rounded-md bg-surface p-3 text-sm text-ink/80">{problem}</p> : <>
          <video ref={video} muted playsInline className="aspect-[4/3] w-full rounded-lg bg-ink/90 object-cover" />
          <p className="text-xs text-ink/60">Hold the product's own barcode or QR code in front of the camera. It is read automatically.</p>
        </>}
        <div className="flex justify-end"><Button variant="secondary" onClick={onClose}>Close</Button></div>
      </div>
    </Dialog>
  )
}

/** A small camera button that opens the scanner, shown only where the browser can scan. */
export function ScanButton({ onScan, label = 'Scan', title }: { onScan: (code: string) => void; label?: string; title?: string }) {
  const [open, setOpen] = useState(false)
  if (!cameraScanSupported()) return null
  return (
    <>
      <Button type="button" variant="secondary" onClick={() => setOpen(true)}><Camera className="size-4" aria-hidden /> {label}</Button>
      {open && <BarcodeScanDialog title={title} onClose={() => setOpen(false)} onScan={(c) => { setOpen(false); onScan(c) }} />}
    </>
  )
}
