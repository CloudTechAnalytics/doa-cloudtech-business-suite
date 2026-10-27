import { beforeAll, describe, expect, it } from 'vitest'
import { buildApps, sidebarEntries } from '@/app/navigation/navigation'
import { demoCategories, demoCounts, demoCreateCategory, demoCreateProduct, demoImportProducts, demoPostCount, demoReceive, demoRecordCount, demoStartCount, demoUpdateProduct, ensureDemoInventory, getInv } from '@/demo/demoInventory'
import { demoSignIn, demoSignOut } from '@/demo/demoStore'
import * as t from '@/demo/demoTrade'
import { inventoryModule } from '@/modules/inventory/manifest'
import { loadCatalog } from '@/modules/sales/tradeApi'
import type { InventoryData } from '@/modules/inventory/inventoryApi'
import { needsAttention, productExport, stockExport, stockRows, summarise, toProductRows } from '@/modules/inventory/stockLogic'

const as = (email: string) => { demoSignOut(); demoSignIn(email, 'demo1234') }
let n = 0
const key = () => `dinv-${Date.now()}-${n++}-abcdefgh`

describe('the inventory demo mirror', () => {
  let biz: string, loc: string
  beforeAll(() => { as('owner@demo.test'); biz = 'b-retail'; ensureDemoInventory(biz, 'retail'); t.ensureDemoTrade(biz); loc = getInv().locations.find((l) => l.businessId === biz)!.id })
  const sku = (s: string) => getInv().products.find((p) => p.businessId === biz && p.sku === s)
  const qty = (s: string) => getInv().balances[`${biz}|${sku(s)!.id}|${loc}`]?.qty ?? 0

  it('imports products with categories, services and opening stock through the ledger', () => {
    const r = demoImportProducts(biz, loc, [
      { name: 'Bottled water', sku: 'DWAT', category: 'Drinks', price: '200', cost: '120', reorder: '10', quantity: '48' },
      { name: 'Orange juice', sku: 'DOJ', category: 'drinks', price: '500', quantity: '12' },
      { name: 'Delivery', sku: 'DDEL', type: 'Service', price: '1500' },
    ], key())
    expect(r.error).toBeNull(); expect(r.result).toMatchObject({ created: 3, stocked: 2, duplicates: [], invalid: [] })
    expect(qty('DWAT')).toBe(48); expect(sku('DDEL')!.tracksStock).toBe(false)
    expect(demoCategories(biz).filter((c) => c.name.toLowerCase() === 'drinks')).toHaveLength(1)
    expect(getInv().movements.filter((m) => m.productId === sku('DDEL')!.id)).toHaveLength(0)
  })

  it('skips duplicates and unreadable rows exactly as the database does', () => {
    const r = demoImportProducts(biz, loc, [
      { name: 'Again', sku: 'dwat' }, { name: 'New thing', sku: 'DNEW', barcode: 'D600111' }, { name: 'Other', barcode: 'd600111' }, { name: 'ORANGE juice' }, { name: 'Plain' }, { name: 'plain' },
      { name: '', sku: 'DE1' }, { name: 'Bad', sku: 'DE2', price: 'abc' }, { name: 'Neg', sku: 'DE3', cost: '-5' }, { name: 'Unit', sku: 'DE4', unit: 'bucket' }, { name: 'Svc stock', sku: 'DE5', type: 'service', quantity: '4' },
    ], key()).result!
    expect(r.created).toBe(2); expect(r.duplicates).toEqual([1, 3, 4, 6]); expect(r.invalid.map((x) => x.row)).toEqual([7, 8, 9, 10, 11])
  })

  it('does nothing the second time, takes at most 500 rows, and asks where stock goes', () => {
    const k = key(); const rows = [{ name: 'Once only', sku: 'DONCE', quantity: '3' }]
    const a = demoImportProducts(biz, loc, rows, k); const b = demoImportProducts(biz, loc, rows, k)
    expect(b.result).toEqual(a.result); expect(qty('DONCE')).toBe(3)
    expect(demoImportProducts(biz, loc, Array.from({ length: 501 }, (_, i) => ({ name: `P${i}`, sku: `DBIG${i}` })), key()).error).toMatch(/500/)
    expect(demoImportProducts(biz, loc, [], key()).error).toMatch(/no rows/)
    expect(demoImportProducts(biz, null, [{ name: 'No place', sku: 'DNP', quantity: '5' }], key()).result!.invalid[0].reason).toMatch(/where/)
  })

  it('refuses stock movements on a service', () => {
    const svc = sku('DDEL')!
    expect(demoReceive(biz, loc, [{ productId: svc.id, quantity: 1 }], '', key())).toMatch(/does not track stock/)
  })

  it('sells a service with no stock check and no movement, and can still void it', () => {
    const svc = sku('DDEL')!
    const before = getInv().movements.length
    const sale = t.demoPostSale(biz, loc, null, [{ productId: svc.id, quantity: 2 }], [{ method: 'cash', amount: 3000 }], key())
    expect(sale.error ?? null).toBeNull()
    expect(getInv().movements.length).toBe(before)
  })

  it('edits a product and refuses a SKU or barcode that another product holds', () => {
    const p = sku('DWAT')!
    expect(demoUpdateProduct(biz, p.id, { name: 'Water 75cl', sku: 'DWAT', barcode: '', sellingPrice: 250, defaultCost: 130, reorderLevel: 12, categoryId: demoCategories(biz)[0].id })).toBeNull()
    expect(sku('DWAT')).toMatchObject({ name: 'Water 75cl', sellingPrice: 250, reorderLevel: 12 })
    expect(demoUpdateProduct(biz, p.id, { name: 'Water', sku: 'DOJ', barcode: '', sellingPrice: 1, defaultCost: null, reorderLevel: null, categoryId: null })).toMatch(/duplicate/)
    expect(demoUpdateProduct(biz, p.id, { name: ' ', sku: '', barcode: '', sellingPrice: 1, defaultCost: null, reorderLevel: null, categoryId: null })).toMatch(/name/)
  })

  it('keeps one category per name', () => {
    const a = demoCreateCategory(biz, 'Snacks'); const b = demoCreateCategory(biz, ' snacks ')
    expect(a.error).toBeNull(); expect(b.id).toBe(a.id)
  })

  it('counts: lists what the books say, posts only the differences against the stock at the time, and cannot post twice', () => {
    const wat = sku('DWAT')!; const oj = sku('DOJ')!
    const start = demoStartCount(biz, loc, key()); const id = start.result!.countId
    const c = demoCounts(biz).find((x) => x.id === id)!
    expect(c.items.find((i) => i.productId === wat.id)!.expected).toBe(48); expect(c.items.some((i) => i.productId === sku('DDEL')!.id)).toBe(false) // services are not counted
    expect(demoRecordCount(biz, id, wat.id, 45)).toBeNull(); expect(demoRecordCount(biz, id, oj.id, 12)).toBeNull()
    expect(demoRecordCount(biz, id, wat.id, -1)).toMatch(/zero or more/)
    getInv().balances[`${biz}|${wat.id}|${loc}`].qty -= 2 // stock moves while counting
    const k = key(); const post = demoPostCount(biz, id, k)
    expect(post.result).toEqual({ adjusted: 1 }); expect(qty('DWAT')).toBe(45)
    expect(demoPostCount(biz, id, k).result).toEqual({ adjusted: 1 })
    expect(demoPostCount(biz, id, key()).error).toMatch(/already posted/)
    expect(demoRecordCount(biz, id, wat.id, 1)).toMatch(/already posted/)
  })

  it('sends services through the till catalogue with their flag, and lists the categories', async () => {
    const cat = await loadCatalog(biz, 'retail')
    expect(cat.products.find((p) => p.sku === 'DDEL')).toMatchObject({ tracksStock: false })
    expect(cat.products.find((p) => p.sku === 'DWAT')).toMatchObject({ tracksStock: true })
    expect(cat.categories.map((c) => c.name)).toContain('Drinks')
  })

  it('is closed to a role that cannot change stock', () => {
    as('teacher@demo.test')
    expect(demoImportProducts(biz, loc, [{ name: 'Nope', sku: 'DNOPE' }], key()).error).toBeTruthy()
    expect(demoCreateProduct(biz, { name: 'Nope', sku: '', barcode: '', unit: 'each', sellingPrice: 1, defaultCost: null, reorderLevel: null })).toBeTruthy()
    as('owner@demo.test')
  })
})

describe('what the stock screens work out', () => {
  const p = (id: string, over: Partial<InventoryData['products'][number]> = {}) => ({ id, sku: id.toUpperCase(), barcode: null, name: id, unit: 'each', sellingPrice: 100, defaultCost: 50, reorderLevel: 10, status: 'active' as const, tracksStock: true, categoryId: null, ...over })
  const data: InventoryData = {
    units: ['each'], categories: [{ id: 'c1', name: 'Drinks' }], locations: [{ id: 'l1', name: 'Main' }, { id: 'l2', name: 'Back' }], movements: [],
    products: [p('water', { reorderLevel: 10, categoryId: 'c1' }), p('juice', { reorderLevel: 20 }), p('salt', { reorderLevel: null }), p('rice', { reorderLevel: 5 }), p('delivery', { tracksStock: false }), p('old', { status: 'archived' })],
    balances: [
      { productId: 'water', locationId: 'l1', qty: 4, avgCost: 100 }, { productId: 'water', locationId: 'l2', qty: 3, avgCost: 100 },
      { productId: 'juice', locationId: 'l1', qty: 0, avgCost: 200 }, { productId: 'rice', locationId: 'l1', qty: 50, avgCost: 10 },
    ],
  }

  it('leaves services and archived products out of the stock list and counts them separately', () => {
    const rows = stockRows(data)
    expect(rows.map((r) => r.p.id)).toEqual(['water', 'juice', 'salt', 'rice'])
    const s = summarise(data, rows)
    expect(s).toMatchObject({ products: 4, services: 1, out: 2, low: 1 }); expect(s.value).toBe(7 * 100 + 50 * 10)
  })

  it('looks at one location when asked', () => {
    const w = stockRows(data, 'l2').find((r) => r.p.id === 'water')!
    expect(w.qty).toBe(3); expect(w.st).toBe('low')
  })

  it('puts out-of-stock first, then low, and only suggests a quantity where a reorder level is set', () => {
    const a = needsAttention(stockRows(data))
    expect(a.map((r) => [r.p.id, r.st])).toEqual([['juice', 'out'], ['salt', 'out'], ['water', 'low']])
    expect(a.find((r) => r.p.id === 'juice')!.suggest).toBe(40) // twice the reorder level of 20, from nothing
    expect(a.find((r) => r.p.id === 'water')!.suggest).toBe(13) // twice 10, less the 7 on hand
    expect(a.find((r) => r.p.id === 'salt')!.suggest).toBeNull()
  })

  it('exports the stock and the product list with the import template\'s headings', () => {
    const csv = stockExport(data, stockRows(data))
    expect(csv[0]).toEqual(['Product', 'SKU', 'Barcode', 'Category', 'Unit', 'On hand', 'Average cost', 'Value', 'Reorder level', 'Status'])
    expect(csv[1]).toEqual(['water', 'WATER', null, 'Drinks', 'each', 7, 100, 700, 10, 'Low stock'])
    const list = productExport(data)
    expect(list[0]).toContain('Opening stock'); expect(list.map((r) => r[0])).toContain('delivery'); expect(list.map((r) => r[0])).not.toContain('old')
    expect(list.find((r) => r[0] === 'delivery')![4]).toBe('Service')
  })
})

describe('reading a product spreadsheet', () => {
  it('matches headings loosely, ignores what it does not know, and reports whether any opening stock was given', () => {
    const r = toProductRows('Item name,Code,UOM,Retail Price,Buying price,Min stock,Qty,Colour\r\nWater,W1,each,"1,200",800,10,24,Blue\r\nDelivery,D1,each,1500,,,,')
    expect(r.missingName).toBe(false); expect(r.ignored).toEqual(['Colour']); expect(r.hasStock).toBe(true)
    expect(r.rows[0]).toMatchObject({ name: 'Water', sku: 'W1', unit: 'each', price: '1200', cost: '800', reorder: '10', quantity: '24' })
    expect(r.rows[1]).toMatchObject({ name: 'Delivery', price: '1500', quantity: '' })
  })
  it('needs a Name column and handles an empty file', () => {
    expect(toProductRows('Code,Price\r\nA,1').missingName).toBe(true)
    expect(toProductRows('').missingName).toBe(true)
    expect(toProductRows('Name\r\nA').hasStock).toBe(false)
  })
})

describe('the sidebar for the Inventory app', () => {
  it('lists each part as its own link when Inventory is the whole app', () => {
    const entries = sidebarEntries(buildApps('general', new Set(['dashboard', 'inventory'])))
    expect(entries.filter((e) => e.kind === 'section' && e.module.code === 'inventory').map((e) => (e.kind === 'section' ? e.section.key : ''))).toEqual(['stock', 'products', 'counts', 'movements', 'receive', 'adjust', 'transfer', 'locations'])
  })
  it('shows the parts beside the till too, since the product list is the same Inventory', () => {
    expect(sidebarEntries(buildApps('general', new Set(['dashboard', 'sales', 'inventory']))).filter((e) => e.kind === 'section' && e.module.code === 'inventory')).toHaveLength(8)
  })
  it('keeps the quick action on the new address style', () => {
    expect(inventoryModule.definition.quickAction?.query).toBe('tab=receive')
  })
})
