/** The sales tax (percent) a business charges, from its saved settings: 0 when none is set or the value is not a usable number. The till previews totals with this, the server charges with the same rate. */
export function taxRateOf(settings: { tax_rate_percent?: unknown } | null | undefined): number {
  const n = Number(settings?.tax_rate_percent ?? 0)
  return Number.isFinite(n) && n > 0 && n <= 100 ? n : 0
}
