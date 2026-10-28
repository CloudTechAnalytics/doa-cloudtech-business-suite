/** What a business prints at the top and bottom of its receipts, from its saved settings. Anything missing is an empty string. */
export interface ReceiptDetails { address: string; phone: string; footer: string }

export function receiptOf(settings: { receipt?: unknown } | null | undefined): ReceiptDetails {
  const r = (settings?.receipt && typeof settings.receipt === 'object' ? settings.receipt : {}) as Record<string, unknown>
  const s = (k: string) => (typeof r[k] === 'string' ? (r[k] as string).trim().slice(0, 200) : '')
  return { address: s('address'), phone: s('phone'), footer: s('footer') }
}
