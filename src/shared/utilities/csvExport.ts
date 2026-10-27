/** Writes rows as CSV, quoting anything with a comma, quote or line break. */
export const toCsv = (rows: (string | number | null | undefined)[][]) => rows.map((r) => r.map((c) => { const s = String(c ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }).join(',')).join('\r\n')

/** Starts the browser download of a CSV file (with a byte-order mark so Excel reads naira and accents correctly). */
export function downloadCsv(filename: string, rows: (string | number | null | undefined)[][]) {
  const url = URL.createObjectURL(new Blob([`﻿${toCsv(rows)}`], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url)
}

/** Starts the browser download of any text file (for example a calendar file). */
export function downloadFile(filename: string, text: string, mime = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }))
  const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url)
}
