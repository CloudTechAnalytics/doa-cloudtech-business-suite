/**
 * Reads CSV text into rows of cells: quoted cells (with commas, line breaks and doubled quotes inside), Windows or Unix line ends, and a leading byte-order mark.
 * Blank lines are skipped. It does not guess at meaning: the caller maps columns by their header.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []; let cell = ''; let quoted = false
  const src = text.replace(/^\uFEFF/, '')
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (quoted) {
      if (c === '"') { if (src[i + 1] === '"') { cell += '"'; i++ } else quoted = false } else cell += c
    } else if (c === '"') quoted = true
    else if (c === ',') { row.push(cell); cell = '' }
    else if (c === '\n' || c === '\r') { if (c === '\r' && src[i + 1] === '\n') i++; row.push(cell); cell = ''; if (row.some((x) => x.trim() !== '')) rows.push(row); row = [] }
    else cell += c
  }
  row.push(cell)
  if (row.some((x) => x.trim() !== '')) rows.push(row)
  return rows.map((r) => r.map((x) => x.trim()))
}

/** Turns CSV text with a header row into objects keyed by the lower-cased, underscore-joined header (so "Date of Birth" and date_of_birth both read as date_of_birth). */
export function parseCsvObjects(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const [head, ...body] = parseCsv(text)
  const headers = (head ?? []).map((h) => h.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''))
  return { headers, rows: body.map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? '']))) }
}
