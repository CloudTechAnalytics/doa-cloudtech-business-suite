import { describe, expect, it } from 'vitest'
import { receiptOf } from '@/core/business-context/receiptDetails'
import { demoSetReceipt, demoSignIn, demoSignOut, getDemoState } from '@/demo/demoStore'

describe('the details a business prints on its receipts', () => {
  it('reads the address, phone and closing line, and treats anything else as empty', () => {
    expect(receiptOf({ receipt: { address: ' 12 Market Road ', phone: '0803', footer: 'Thanks' } })).toEqual({ address: '12 Market Road', phone: '0803', footer: 'Thanks' })
    for (const bad of [null, undefined, {}, { receipt: null }, { receipt: 'x' }, { receipt: { address: 5 } }]) expect(receiptOf(bad as never)).toEqual({ address: '', phone: '', footer: '' })
    expect(receiptOf({ receipt: { footer: 'x'.repeat(500) } }).footer).toHaveLength(200)
  })
  it('is set by the owner in the demo, cleared when emptied, and refused to a cashier and for too long a line', () => {
    const B = getDemoState().businesses.find((b) => b.industry === 'retail')!.id
    demoSignOut(); demoSignIn('cashier@demo.test', 'demo1234')
    expect(demoSetReceipt(B, { address: 'a', phone: 'b', footer: 'c' })).toMatch(/permission denied/)
    demoSignOut(); demoSignIn('owner@demo.test', 'demo1234')
    expect(demoSetReceipt(B, { address: 'a', phone: '', footer: 'x'.repeat(201) })).toMatch(/up to 200/)
    expect(demoSetReceipt(B, { address: '12 Market Road', phone: '0803', footer: '' })).toBeNull()
    expect(getDemoState().businesses.find((b) => b.id === B)!.settings?.receipt).toEqual({ address: '12 Market Road', phone: '0803' })
    expect(demoSetReceipt(B, { address: '', phone: '', footer: '' })).toBeNull()
    expect(getDemoState().businesses.find((b) => b.id === B)!.settings?.receipt).toBeUndefined()
  })
})
