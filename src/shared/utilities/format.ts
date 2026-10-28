export const naira = (n: number | null | undefined) =>
  n === null || n === undefined ? '–' : `₦${n.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
export const qty = (n: number) => n.toLocaleString('en-NG', { maximumFractionDigits: 4 })
export const dateTime = (iso: string) => new Date(iso).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' })
/** A stored word as a label: underscores become spaces and the first letter is a capital; a few words are always written as the acronym they are. */
export const label = (s: string) => (s === 'pos' ? 'POS' : s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()))
