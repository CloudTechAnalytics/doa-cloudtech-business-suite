/** Money in naira: a loss is written -₦67.50 (sign first), and a rounded zero never shows a minus sign. */
export const naira = (n: number | null | undefined) => {
  if (n === null || n === undefined) return '–'
  const body = Math.abs(n).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return n < 0 && Number(body.replace(/,/g, '')) !== 0 ? `-₦${body}` : `₦${body}`
}
export const qty = (n: number) => n.toLocaleString('en-NG', { maximumFractionDigits: 4 })
export const dateTime = (iso: string) => new Date(iso).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' })
/** A stored word as a label: underscores become spaces and the first letter is a capital; a few words are always written as the acronym they are. */
export const label = (s: string) => (s === 'pos' ? 'POS' : s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()))
