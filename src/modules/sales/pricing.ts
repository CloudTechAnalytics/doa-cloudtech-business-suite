/**
 * Cart pricing with exact integer arithmetic (no floating point), mirroring post_sale() in SQL:
 *   gross = round(qty * price, 2); net = gross - discount; tax = round(net * rate / 100, 2).
 * The browser uses this only for a live preview and for demo mode. The database always recomputes
 * totals, and tests/db/pricing-parity.test.ts proves both agree. Amounts are in minor units (kobo).
 */
export interface CartLine { quantity: number; unitPrice: number; discount: number }
export interface PricedLine { gross: number; discount: number; tax: number; total: number }
export interface PricedCart { lines: PricedLine[]; subtotal: number; discountTotal: number; taxTotal: number; grandTotal: number }

const toScaled = (v: number, scale: number) => BigInt(Math.round(v * scale))
/** Half-up division for non-negative numerators, like Postgres round() on positive numerics. */
const divRound = (num: bigint, den: bigint) => (num + den / 2n) / den

export const toNumber = (minor: bigint) => Number(minor) / 100

export function priceCart(lines: CartLine[], taxRatePercent = 0): PricedCart {
  const rateHundredths = toScaled(taxRatePercent, 100)
  const out: PricedLine[] = []
  let subtotal = 0n, discountTotal = 0n, taxTotal = 0n
  for (const l of lines) {
    const qty4 = toScaled(l.quantity, 10000)
    const price = toScaled(l.unitPrice, 100)
    const gross = divRound(qty4 * price, 10000n)
    const discount = toScaled(l.discount, 100)
    if (discount > gross) throw new Error('discount exceeds the line amount')
    const net = gross - discount
    const tax = divRound(net * rateHundredths, 10000n)
    out.push({ gross: toNumber(gross), discount: toNumber(discount), tax: toNumber(tax), total: toNumber(net + tax) })
    subtotal += gross; discountTotal += discount; taxTotal += tax
  }
  return {
    lines: out,
    subtotal: toNumber(subtotal),
    discountTotal: toNumber(discountTotal),
    taxTotal: toNumber(taxTotal),
    grandTotal: toNumber(subtotal - discountTotal + taxTotal),
  }
}

/** Splits a line refund so the last returnable unit takes the remainder (no cent drift). */
export function refundForReturn(lineTotal: number, soldQty: number, priorQty: number, priorRefund: number, returnQty: number): number {
  const remaining = Math.round((soldQty - priorQty) * 10000)
  if (Math.round(returnQty * 10000) === remaining) return toNumber(toScaled(lineTotal, 100) - toScaled(priorRefund, 100))
  return toNumber(divRound(toScaled(lineTotal, 100) * toScaled(returnQty, 10000), toScaled(soldQty, 10000)))
}
