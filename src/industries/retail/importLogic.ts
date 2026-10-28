import { parseCsv, toCsv } from './csv'

/**
 * What a product or category CSV may hold, the downloadable templates, and the checks run before anything is saved. Kept apart from the screens so they can be
 * tested: the dialogs only show what these return.
 */
export interface ImportColumn { name: string; required: boolean; help: string; example: string }

export const PRODUCT_COLUMNS: ImportColumn[] = [
  { name: 'name', required: true, help: 'What you sell, as customers know it.', example: 'Indomie Noodles 70g' },
  { name: 'price', required: true, help: 'Selling price for one unit, in naira. Numbers only, no ₦ sign.', example: '200' },
  { name: 'cost', required: false, help: 'What you pay for one unit. Leave empty if you do not know it; receiving stock sets the real average.', example: '150' },
  { name: 'category', required: false, help: 'The group it belongs to, such as Groceries. A category that does not exist yet can be created for you.', example: 'Groceries' },
  { name: 'sku', required: false, help: 'Your own code for it. Each one must be different.', example: 'NOOD70' },
  { name: 'barcode', required: false, help: 'The code printed on the product. Each one must be different.', example: '6001234567890' },
  { name: 'brand', required: false, help: 'The maker or brand.', example: 'Indomie' },
  { name: 'unit', required: false, help: 'How it is sold: each, dozen, kg, g, l or ml. Empty means each.', example: 'each' },
  { name: 'wholesale', required: false, help: 'A wholesale price, for your reference. The till uses the selling price.', example: '180' },
  { name: 'reorder', required: false, help: 'Warn me when the stock falls to this number.', example: '20' },
]
export const CATEGORY_COLUMNS: ImportColumn[] = [{ name: 'name', required: true, help: 'The category name, such as Groceries, Drinks or Household.', example: 'Groceries' }]

export const UNITS = ['each', 'dozen', 'kg', 'g', 'l', 'ml']

/** A row whose name ends with "(example)" is an illustration in the template, never a real record: it is skipped, so a template can be sent back as it is without adding rubbish. */
export const isExampleRow = (name: string) => /\(example\)\s*$/i.test(name.trim())

const cols = (list: ImportColumn[]) => list.map((c) => c.name)
export const productTemplateRows = (): string[][] => [
  cols(PRODUCT_COLUMNS),
  ['Indomie Noodles 70g (example)', '200', '150', 'Groceries', 'NOOD70', '6001234567890', 'Indomie', 'each', '180', '20'],
  ['Peak Milk Tin 400g (example)', '2500', '2100', 'Groceries', 'MILK400', '6009876543210', 'Peak', 'each', '', '10'],
]
export const categoryTemplateRows = (): string[][] => [cols(CATEGORY_COLUMNS), ['Groceries (example)'], ['Drinks (example)']]
export const productTemplateCsv = () => toCsv(productTemplateRows())
export const categoryTemplateCsv = () => toCsv(categoryTemplateRows())

const norm = (s: string) => s.trim().toLowerCase()

// ------------------------------------------------------------------------- products
export interface ProductRow { line: number; name: string; g: (column: string) => string; category: string; knownCategory: { id: string; name: string } | undefined; problems: string[] }
export interface ProductAnalysis { missing: string[]; rows: ProductRow[]; skippedExamples: number; newCategories: string[] }

export function analyseProducts(
  text: string,
  existing: { name: string; sku: string | null; barcode: string | null }[],
  categories: { id: string; name: string }[],
  createMissingCategories: boolean,
): ProductAnalysis {
  const grid = parseCsv(text)
  const head = (grid[0] ?? []).map(norm)
  const col = (name: string) => head.indexOf(name)
  const missing = ['name', 'price'].filter((h) => col(h) < 0)
  const body = grid.slice(1).map((r, i) => ({ r, line: i + 2 })).filter((x) => x.r.some((c) => c.trim()))
  const names = new Set(existing.map((p) => norm(p.name))); const skus = new Set(existing.map((p) => p.sku?.toLowerCase()).filter(Boolean)); const barcodes = new Set(existing.map((p) => p.barcode).filter(Boolean))
  const seenNames = new Set<string>(); const seenSkus = new Set<string>(); const seenCodes = new Set<string>()
  let skippedExamples = 0
  const rows: ProductRow[] = []
  for (const { r, line } of body) {
    const g = (name: string) => (col(name) >= 0 ? (r[col(name)] ?? '').trim() : '')
    const name = g('name')
    if (isExampleRow(name)) { skippedExamples++; continue }
    const problems: string[] = []
    const price = g('price'); const cost = g('cost'); const unit = g('unit').toLowerCase()
    if (name.length < 2) problems.push('name is missing')
    if (price === '' || !(Number(price) >= 0)) problems.push('price must be a number')
    else if (Math.round(Number(price) * 100) / 100 !== Number(price)) problems.push('price can have at most 2 decimals')
    if (cost !== '' && !(Number(cost) >= 0)) problems.push('cost must be a number')
    if (g('wholesale') !== '' && !(Number(g('wholesale')) >= 0)) problems.push('wholesale must be a number')
    if (g('reorder') !== '' && !(Number(g('reorder')) >= 0)) problems.push('reorder must be a number')
    if (unit && !UNITS.includes(unit)) problems.push(`unit "${g('unit')}" is not one of ${UNITS.join(', ')}`)
    if (name && (names.has(norm(name)) || seenNames.has(norm(name)))) problems.push('a product with this name already exists')
    if (g('sku') && (skus.has(g('sku').toLowerCase()) || seenSkus.has(g('sku').toLowerCase()))) problems.push('SKU already used')
    if (g('barcode') && (barcodes.has(g('barcode')) || seenCodes.has(g('barcode')))) problems.push('barcode already used')
    const category = g('category')
    const knownCategory = category ? categories.find((c) => norm(c.name) === norm(category)) : undefined
    if (category && !knownCategory && !createMissingCategories) problems.push(`category "${category}" does not exist`)
    if (name) seenNames.add(norm(name)); if (g('sku')) seenSkus.add(g('sku').toLowerCase()); if (g('barcode')) seenCodes.add(g('barcode'))
    rows.push({ line, name, g, category, knownCategory, problems })
  }
  const newCategories: string[] = []
  for (const r of rows) if (!r.problems.length && r.category && !r.knownCategory && !newCategories.some((n) => norm(n) === norm(r.category))) newCategories.push(r.category)
  return { missing, rows, skippedExamples, newCategories }
}

// ------------------------------------------------------------------------ categories
export interface CategoryRow { line: number; name: string; problems: string[] }
export interface CategoryAnalysis { missing: string[]; rows: CategoryRow[]; skippedExamples: number }

export function analyseCategories(text: string, existing: { name: string }[]): CategoryAnalysis {
  const grid = parseCsv(text)
  const head = (grid[0] ?? []).map(norm)
  const at = head.indexOf('name')
  const missing = at < 0 ? ['name'] : []
  const have = new Set(existing.map((c) => norm(c.name))); const seen = new Set<string>()
  let skippedExamples = 0
  const rows: CategoryRow[] = []
  grid.slice(1).forEach((r, i) => {
    if (!r.some((c) => c.trim())) return
    const name = (at >= 0 ? (r[at] ?? '') : '').trim()
    if (isExampleRow(name)) { skippedExamples++; return }
    const problems: string[] = []
    if (name.length < 2) problems.push('name is missing or too short')
    else if (name.length > 80) problems.push('name is longer than 80 characters')
    else if (have.has(norm(name)) || seen.has(norm(name))) problems.push('this category already exists')
    if (name) seen.add(norm(name))
    rows.push({ line: i + 2, name, problems })
  })
  return { missing, rows, skippedExamples }
}
