import qrcode from 'qrcode-generator'

/** A QR code drawn as plain SVG shapes (no images, nothing injected), crisp at any size and in print. */
export function QrCode({ value, className = '', label = 'QR code' }: { value: string; className?: string; label?: string }) {
  const qr = qrcode(0, 'M')
  qr.addData(value)
  qr.make()
  const n = qr.getModuleCount()
  let path = ''
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) path += `M${c} ${r}h1v1h-1z`
  return (
    <svg viewBox={`-2 -2 ${n + 4} ${n + 4}`} role="img" aria-label={label} className={className} shapeRendering="crispEdges">
      <rect x="-2" y="-2" width={n + 4} height={n + 4} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  )
}
