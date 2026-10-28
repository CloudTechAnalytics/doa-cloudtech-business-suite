import { describe, expect, it } from 'vitest'
import { codeFrom } from '@/shared/components/BarcodeScanner'

describe('the code read from a product', () => {
  it('uses a plain barcode as it is, without spaces around it', () => {
    expect(codeFrom('  6001234567890 ')).toEqual(['6001234567890'])
    expect(codeFrom('COLA500')).toEqual(['COLA500'])
  })
  it('also tries the code inside a QR code that holds a web address: its code parameter, or its last part', () => {
    expect(codeFrom('https://brand.example/p/6001234567890')).toEqual(['https://brand.example/p/6001234567890', '6001234567890'])
    expect(codeFrom('https://brand.example/item?code=ABC-123')).toEqual(['https://brand.example/item?code=ABC-123', 'ABC-123', 'item'])
    expect(codeFrom('https://brand.example/')).toEqual(['https://brand.example/'])
  })
  it('does not break on text that is not an address', () => { expect(codeFrom('not a url: 123')).toEqual(['not a url: 123']) })
})
