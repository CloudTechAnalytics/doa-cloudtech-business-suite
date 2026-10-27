import { parseCsv } from '@/shared/utilities/csv'
import type { Category, InventoryData, Product, ProductImportRow } from './inventoryApi'
import { stockStatus } from './ledger'
import type { StockStatus } from './ledger'

/** Pure rules behind the Inventory screens, kept apart from the components so they can be tested on their own. */

export interface StockRow { p: Product; qty: number; value: number; avg: number | null; st: StockStatus }

/** One row per active product that keeps stock, with what is on hand (in one location, or all of them). Services are not stock and are left out. */
export function stockRows(data: InventoryData, locationId = ''): StockRow[] {
  return data.products.filter((p) => p.status === 'active' && p.tracksStock).map((p) => {
    const bals = data.balances.filter((b) => b.productId === p.id && (!locationId || b.locationId === locationId))
    const qty = bals.reduce((s, b) => s + b.qty, 0)
    const value = bals.reduce((s, b) => s + b.qty * (b.avgCost ?? 0), 0)
    return { p, qty, avg: qty > 0 ? value / qty : null, value, st: stockStatus(qty, p.reorderLevel) }
  })
}

export interface Summary { products: number; services: number; value: number; out: number; low: number }
export function summarise(data: InventoryData, rows: StockRow[]): Summary {
  return {
    products: rows.length,
    services: data.products.filter((p) => p.status === 'active' && !p.tracksStock).length,
    value: rows.reduce((s, r) => s + Math.max(r.value, 0), 0),
    out: rows.filter((r) => r.st === 'out').length,
    low: rows.filter((r) => r.st === 'low').length,
  }
}

export interface AttentionRow extends StockRow { suggest: number | null }
/**
 * What needs buying. Out first, then low. The suggested quantity is a plain rule, not a forecast: top the product back up to twice its reorder level.
 * A product with no reorder level set has no suggestion (we do not guess a number for it).
 */
export function needsAttention(rows: StockRow[]): AttentionRow[] {
  return rows.filter((r) => r.st !== 'ok')
    .map((r) => ({ ...r, suggest: r.p.reorderLevel && r.p.reorderLevel > 0 ? Math.max(Math.ceil(r.p.reorderLevel * 2 - Math.max(r.qty, 0)), 1) : null }))
    .sort((a, b) => (a.st === b.st ? a.p.name.localeCompare(b.p.name) : a.st === 'out' ? -1 : 1))
}

export const categoryName = (categories: Category[], id: string | null) => categories.find((c) => c.id === id)?.name ?? ''

/** The stock list as rows for a CSV file you can open in Excel. */
export function stockExport(data: InventoryData, rows: StockRow[]): (string | number | null)[][] {
  const label: Record<StockStatus, string> = { out: 'Out of stock', low: 'Low stock', ok: 'In stock' }
  return [
    ['Product', 'SKU', 'Barcode', 'Category', 'Unit', 'On hand', 'Average cost', 'Value', 'Reorder level', 'Status'],
    ...rows.map((r) => [r.p.name, r.p.sku, r.p.barcode, categoryName(data.categories, r.p.categoryId), r.p.unit, r.qty, r.avg === null ? null : Math.round(r.avg * 100) / 100, Math.round(r.value * 100) / 100, r.p.reorderLevel, label[r.st]]),
  ]
}
/** Every product, services included, so a list can be edited and brought back in. Headings match the import template. */
export function productExport(data: InventoryData): (string | number | null)[][] {
  return [
    PRODUCT_TEMPLATE[0],
    ...data.products.filter((p) => p.status === 'active').map((p) => [p.name, p.sku, p.barcode, p.unit, p.tracksStock ? 'Product' : 'Service', categoryName(data.categories, p.categoryId), p.sellingPrice, p.defaultCost, p.reorderLevel, '']),
  ]
}

// ------------------------------------------------------------------------------------ import
export const MAX_IMPORT = 500
export const PRODUCT_TEMPLATE = [
  ['Name', 'SKU', 'Barcode', 'Unit', 'Type', 'Category', 'Selling price', 'Cost', 'Reorder level', 'Opening stock'],
  ['Bottled water 75cl', 'WAT-75', '6001234567890', 'each', 'Product', 'Drinks', '200', '120', '24', '96'],
  ['Delivery within Lagos', '', '', 'each', 'Service', 'Services', '1500', '', '', ''],
]

const ALIASES: Record<keyof ProductImportRow, string[]> = {
  name: ['name', 'product', 'product name', 'item', 'item name', 'description'],
  sku: ['sku', 'code', 'item code', 'product code'],
  barcode: ['barcode', 'bar code', 'ean', 'upc', 'gtin'],
  unit: ['unit', 'uom', 'unit of measure'],
  type: ['type', 'kind', 'item type'],
  category: ['category', 'group', 'department'],
  price: ['selling price', 'price', 'sale price', 'sell price', 'unit price', 'retail price'],
  cost: ['cost', 'cost price', 'purchase cost', 'buying price', 'default cost', 'unit cost'],
  reorder: ['reorder level', 'reorder', 'reorder point', 'min stock', 'minimum stock', 'low stock level', 'minimum'],
  quantity: ['opening stock', 'quantity', 'qty', 'stock', 'on hand', 'opening quantity', 'opening balance'],
}

/** Turns parsed CSV (first row = headings) into import rows. Headings are matched loosely ("Qty", "Opening stock" and "On hand" all mean the opening quantity); unknown columns are ignored and reported. */
export function toProductRows(text: string): { rows: ProductImportRow[]; ignored: string[]; missingName: boolean; hasStock: boolean } {
  const table = parseCsv(text)
  if (!table.length) return { rows: [], ignored: [], missingName: true, hasStock: false }
  const map: Partial<Record<keyof ProductImportRow, number>> = {}; const ignored: string[] = []
  table[0].forEach((h, i) => {
    const key = h.trim().toLowerCase()
    const field = (Object.keys(ALIASES) as (keyof ProductImportRow)[]).find((f) => ALIASES[f].includes(key) && map[f] === undefined)
    if (field) map[field] = i; else if (key) ignored.push(h.trim())
  })
  if (map.name === undefined) return { rows: [], ignored, missingName: true, hasStock: false }
  const get = (r: string[], f: keyof ProductImportRow) => (map[f] === undefined ? '' : (r[map[f]!] ?? '').trim().replace(/^₦/, '').replace(/(?<=\d),(?=\d{3}\b)/g, ''))
  const rows = table.slice(1).map((r) => ({
    name: (map.name === undefined ? '' : (r[map.name] ?? '')).trim(), sku: get(r, 'sku'), barcode: get(r, 'barcode'), unit: get(r, 'unit'), type: get(r, 'type'), category: get(r, 'category'),
    price: get(r, 'price'), cost: get(r, 'cost'), reorder: get(r, 'reorder'), quantity: get(r, 'quantity'),
  }))
  return { rows, ignored, missingName: false, hasStock: rows.some((r) => Number(r.quantity) > 0) }
}
