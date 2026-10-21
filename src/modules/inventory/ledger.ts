/**
 * Pure mirror of the database stock rules (apply_stock_movement / _inv_items), used by demo mode.
 * tests/db/ledger-parity.test.ts runs identical scenarios against both and compares results.
 */
export interface Balance { qty: number; avg: number | null }

export class InsufficientStockError extends Error {}

const round4 = (n: number) => Math.round(n * 10000) / 10000

export function applyMovement(
  bal: Balance,
  delta: number,
  unitCost: number | null,
  opts: { allowNegative: boolean; defaultCost: number | null },
): { balance: Balance; unitCost: number } {
  const newQty = round4(bal.qty + delta)
  if (newQty < 0 && !opts.allowNegative) {
    throw new InsufficientStockError(`insufficient stock: ${bal.qty} on hand, ${-delta} requested`)
  }
  if (delta < 0) {
    return { balance: { qty: newQty, avg: bal.avg }, unitCost: bal.avg ?? opts.defaultCost ?? 0 }
  }
  const cost = unitCost ?? bal.avg ?? opts.defaultCost ?? 0
  const avg = bal.qty <= 0 || bal.avg === null ? cost : round4((bal.qty * bal.avg + delta * cost) / newQty)
  return { balance: { qty: newQty, avg }, unitCost: cost }
}

export interface UnitDef { dimension: 'mass' | 'volume' | 'count'; factor: number; code: string }

export function convertQuantity(qty: number, from: UnitDef, to: UnitDef): number {
  if (from.dimension !== to.dimension) {
    throw new Error(`incompatible units: ${from.code} (${from.dimension}) cannot convert to ${to.code} (${to.dimension})`)
  }
  return round4((qty * from.factor) / to.factor)
}

export type StockStatus = 'out' | 'low' | 'ok'

export function stockStatus(qty: number, reorderLevel: number | null): StockStatus {
  if (qty <= 0) return 'out'
  if (reorderLevel !== null && qty <= reorderLevel) return 'low'
  return 'ok'
}
