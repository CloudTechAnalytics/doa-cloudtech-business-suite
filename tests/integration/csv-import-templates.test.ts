import { describe, expect, it } from 'vitest'
import { parseCsv } from '@/industries/retail/csv'
import { CATEGORY_COLUMNS, PRODUCT_COLUMNS, analyseCategories, analyseProducts, categoryTemplateCsv, isExampleRow, productTemplateCsv } from '@/industries/retail/importLogic'

const cats = [{ id: 'c1', name: 'Groceries' }, { id: 'c2', name: 'Drinks' }]
const none: { name: string; sku: string | null; barcode: string | null }[] = []

describe('the product template', () => {
  it('has one column for everything the import understands, the required ones first, and two example rows', () => {
    const grid = parseCsv(productTemplateCsv())
    expect(grid[0]).toEqual(PRODUCT_COLUMNS.map((c) => c.name)); expect(grid[0].slice(0, 2)).toEqual(['name', 'price'])
    expect(PRODUCT_COLUMNS.filter((c) => c.required).map((c) => c.name)).toEqual(['name', 'price'])
    expect(grid).toHaveLength(3); expect(grid.slice(1).every((r) => r.length === grid[0].length)).toBe(true)
    for (const c of PRODUCT_COLUMNS) expect(c.help.length).toBeGreaterThan(10)
  })
  it('can be sent back as it is: its example rows are recognised and skipped, adding nothing', () => {
    const a = analyseProducts(productTemplateCsv(), none, cats, true)
    expect(a.missing).toEqual([]); expect(a.rows).toHaveLength(0); expect(a.skippedExamples).toBe(2)
    expect(isExampleRow('Indomie (example)')).toBe(true); expect(isExampleRow('Indomie (EXAMPLE) ')).toBe(true); expect(isExampleRow('Example Biscuits')).toBe(false)
  })
  it('accepts real rows filled in under the template columns, in any column order', () => {
    const csv = 'price,name,barcode,unit\n200,Bread,6001,each\n1500,Rice 5kg,6002,kg'
    const a = analyseProducts(csv, none, cats, true)
    expect(a.rows.map((r) => [r.name, r.problems.length])).toEqual([['Bread', 0], ['Rice 5kg', 0]])
  })
})

describe('checking a product file before anything is saved', () => {
  const run = (csv: string, existing = none, createMissing = true) => analyseProducts(csv, existing, cats, createMissing)
  it('asks for the name and price columns when the first row does not have them', () => { expect(run('item,cost\nBread,100').missing).toEqual(['name', 'price']) })
  it('flags a missing name, a price that is not a number or has too many decimals, and a unit that does not exist', () => {
    const a = run('name,price,unit,cost\n,100,each,\nBread,abc,each,\nCake,10.555,each,\nTea,100,box,\nSugar,100,each,x')
    expect(a.rows.map((r) => r.problems.join('|'))).toEqual(['name is missing', 'price must be a number', 'price can have at most 2 decimals', 'unit "box" is not one of each, dozen, kg, g, l, ml', 'cost must be a number'])
  })
  it('flags a name, SKU or barcode that already exists, or repeats inside the file', () => {
    const a = run('name,price,sku,barcode\nCola,100,C1,111\ncola,100,C2,222\nFanta,100,C1,333\nSprite,100,C4,111\nMalt,100,C5,444', [{ name: 'Malt', sku: null, barcode: null }])
    expect(a.rows.map((r) => r.problems.join('|'))).toEqual(['', 'a product with this name already exists', 'SKU already used', 'barcode already used', 'a product with this name already exists'])
  })
  it('creates categories that do not exist when asked to, listing each once, and otherwise skips those rows', () => {
    const csv = 'name,price,category\nBread,100,Bakery\nCake,200,bakery\nCola,100,Drinks\nTea,100,Hot drinks'
    const on = run(csv, none, true)
    expect(on.rows.every((r) => r.problems.length === 0)).toBe(true); expect(on.newCategories).toEqual(['Bakery', 'Hot drinks']); expect(on.rows[2].knownCategory?.id).toBe('c2')
    const off = run(csv, none, false)
    expect(off.rows.map((r) => r.problems.join('|'))).toEqual(['category "Bakery" does not exist', 'category "bakery" does not exist', '', 'category "Hot drinks" does not exist'])
  })
  it('ignores blank lines and keeps real line numbers for the messages', () => {
    const a = run('name,price\nBread,100\n\n,\nCake,abc')
    expect(a.rows.map((r) => r.line)).toEqual([2, 5])
  })
})

describe('the category template and import', () => {
  it('has a single name column and two example rows that are skipped', () => {
    const grid = parseCsv(categoryTemplateCsv())
    expect(grid[0]).toEqual(CATEGORY_COLUMNS.map((c) => c.name)); expect(grid).toHaveLength(3)
    const a = analyseCategories(categoryTemplateCsv(), [])
    expect(a.missing).toEqual([]); expect(a.rows).toHaveLength(0); expect(a.skippedExamples).toBe(2)
  })
  it('asks for the name column, and checks each row: too short, too long, already there, repeated', () => {
    expect(analyseCategories('category\nGroceries', []).missing).toEqual(['name'])
    const a = analyseCategories(`name\nGroceries\nx\n${'y'.repeat(81)}\nDrinks\nhousehold\nHOUSEHOLD\nBakery`, [{ name: 'drinks' }])
    expect(a.rows.map((r) => `${r.line}:${r.problems.join('|')}`)).toEqual(['2:', '3:name is missing or too short', '4:name is longer than 80 characters', '5:this category already exists', '6:', '7:this category already exists', '8:'])
  })
})
