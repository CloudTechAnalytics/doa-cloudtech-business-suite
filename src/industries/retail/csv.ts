/** A small CSV reader and writer: quoted fields, doubled quotes and line breaks inside quotes, with a comma separator. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []; let cell = ''; let quoted = false
  const src = text.replace(/^﻿/, '')
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (quoted) {
      if (ch === '"') { if (src[i + 1] === '"') { cell += '"'; i++ } else quoted = false } else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') { row.push(cell); cell = '' }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && src[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = '' }
    else cell += ch
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row) }
  return rows
}

export function toCsv(rows: (string | number)[][]): string {
  const esc = (v: string | number) => (/[",\n\r]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))
  return rows.map((r) => r.map(esc).join(',')).join('\n')
}
