// Draws the app icons (the DOA mark: a teal rounded square with an amber ring) into public/icons as PNG files, with no image library.
// Run: node scripts/make-icons.mjs
import { mkdirSync, writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'

const TEAL = [0x0b, 0x4f, 0x5c]
const AMBER = [0xf5, 0xa8, 0x00]
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const body = Buffer.concat([Buffer.from(type), data]); const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body)); return Buffer.concat([len, body, sum]) }
const png = (size, rgba) => {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++) { raw[y * (size * 4 + 1)] = 0; rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4) }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

/** The mark on a 40-unit square: rounded square (radius 11) with a ring of radius 8.5 and stroke 6. `full` fills the whole canvas (for maskable icons) and shrinks the ring into the safe zone. */
function draw(size, { full = false, pad = 0 } = {}) {
  const out = Buffer.alloc(size * size * 4)
  const SS = 4
  const unit = (size - pad * 2) / 40
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let r = 0, g = 0, b = 0, a = 0
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
      const px = (x + (sx + 0.5) / SS - pad) / unit, py = (y + (sy + 0.5) / SS - pad) / unit
      let col = null
      const inSquare = full ? true : (() => { const cx = Math.min(Math.max(px, 11), 29), cy = Math.min(Math.max(py, 11), 29); return px >= 0 && px <= 40 && py >= 0 && py <= 40 && (px - cx) ** 2 + (py - cy) ** 2 <= 121 })()
      if (inSquare) {
        col = TEAL
        const d = Math.hypot(px - 20, py - 20)
        const ringR = full ? 8.5 * 0.82 : 8.5, half = full ? 3 * 0.82 : 3
        if (Math.abs(d - ringR) <= half) col = AMBER
      }
      if (col) { r += col[0]; g += col[1]; b += col[2]; a += 255 }
    }
    const n = SS * SS, o = (y * size + x) * 4
    const cov = a / 255
    out[o] = cov ? Math.round(r / cov) : 0; out[o + 1] = cov ? Math.round(g / cov) : 0; out[o + 2] = cov ? Math.round(b / cov) : 0; out[o + 3] = Math.round(a / n)
  }
  return out
}

mkdirSync('public/icons', { recursive: true })
for (const [name, size, opts] of [['icon-192.png', 192, { pad: 0 }], ['icon-512.png', 512, { pad: 0 }], ['icon-maskable-512.png', 512, { full: true }], ['apple-touch-icon.png', 180, { full: true }]]) {
  writeFileSync(`public/icons/${name}`, png(size, draw(size, opts)))
  console.log('wrote', name)
}
