import type { ImportRow } from './dealsApi'

/** Reads CSV text (quoted fields, doubled quotes, commas or semicolons, any line ending) into rows of cells. Blank lines are dropped. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '')
  const first = src.split(/\r?\n/, 1)[0] ?? ''
  const sep = (first.match(/;/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0) ? ';' : ','
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let quoted = false
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++ } else if (ch === '"') quoted = false; else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === sep) { row.push(cell); cell = '' }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && src[i + 1] === '\n') i++; row.push(cell); cell = ''; rows.push(row); row = [] }
    else cell += ch
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row) }
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

/** Writes rows as CSV, quoting anything with a comma, quote or line break. */
export const toCsv = (rows: (string | number | null | undefined)[][]) => rows.map((r) => r.map((c) => { const s = String(c ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }).join(',')).join('\r\n')

/** Starts the browser download of a CSV file. */
export function downloadCsv(filename: string, rows: (string | number | null | undefined)[][]) {
  const url = URL.createObjectURL(new Blob([`﻿${toCsv(rows)}`], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url)
}

const ALIASES: Record<keyof ImportRow, string[]> = {
  name: ['name', 'full name', 'fullname', 'contact', 'contact name', 'customer', 'customer name', 'lead', 'lead name', 'first name'],
  phone: ['phone', 'phone number', 'mobile', 'mobile number', 'telephone', 'tel', 'whatsapp', 'cell'],
  email: ['email', 'e-mail', 'email address', 'mail'],
  company: ['company', 'company name', 'organisation', 'organization', 'business', 'business name'],
  city: ['city', 'town', 'location', 'area'],
  source: ['source', 'lead source', 'channel', 'referral'],
  category: ['category', 'type', 'group', 'segment'],
  notes: ['notes', 'note', 'comment', 'comments', 'remarks', 'description'],
}

/** Matches the file's column headings to the fields DOA knows (so "Mobile" and "Phone Number" both become phone). Unknown columns are ignored. */
export function mapHeaders(header: string[]): { map: Partial<Record<keyof ImportRow, number>>; ignored: string[] } {
  const map: Partial<Record<keyof ImportRow, number>> = {}; const ignored: string[] = []
  header.forEach((h, i) => {
    const key = h.trim().toLowerCase()
    const field = (Object.keys(ALIASES) as (keyof ImportRow)[]).find((f) => ALIASES[f].includes(key) && map[f] === undefined)
    if (field) map[field] = i; else if (key) ignored.push(h.trim())
  })
  return { map, ignored }
}

/** Turns parsed CSV (first row = headings) into import rows. */
export function toImportRows(rows: string[][]): { rows: ImportRow[]; ignored: string[]; missingName: boolean } {
  if (!rows.length) return { rows: [], ignored: [], missingName: true }
  const { map, ignored } = mapHeaders(rows[0])
  if (map.name === undefined) return { rows: [], ignored, missingName: true }
  const get = (r: string[], f: keyof ImportRow) => (map[f] === undefined ? undefined : (r[map[f]!] ?? '').trim())
  return { rows: rows.slice(1).map((r) => ({ name: get(r, 'name'), phone: get(r, 'phone'), email: get(r, 'email'), company: get(r, 'company'), city: get(r, 'city'), source: get(r, 'source'), category: get(r, 'category'), notes: get(r, 'notes') })), ignored, missingName: false }
}

export const IMPORT_TEMPLATE = [['Name', 'Phone', 'Email', 'Company', 'City', 'Source', 'Category', 'Notes'], ['Ada Obi', '08031234567', 'ada@example.com', 'Obi Stores', 'Lagos', 'Referral', 'Retailer', 'Wants weekly delivery']]
