import { describe, expect, it } from 'vitest'
import { undoMessage } from '@/modules/inventory/UndoMovementDialog'

describe('what the person is told when an entry cannot be undone', () => {
  it('explains that some of the stock has already gone, with the numbers, and what to do instead', () => {
    const m = undoMessage('insufficient stock: 93.0000 on hand, 100.0000 requested')
    expect(m).toMatch(/already been sold or written off/); expect(m).toContain('93 left, 100 to remove'); expect(m).toMatch(/stock count or record a loss/)
  })
  it('passes any other message through unchanged', () => {
    expect(undoMessage('a reason is required')).toBe('a reason is required')
    expect(undoMessage('this stock movement belongs to a sale, loss, count, return or purchase; undo it there (void the sale or the loss, for example) instead')).toMatch(/belongs to a sale/)
  })
})
