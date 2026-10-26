import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { IdCardBack, IdCardFront } from '@/industries/school/components/StudentSheets'
import type { IdCardData } from '@/industries/school/components/StudentSheets'
import { QrCode } from '@/shared/components/QrCode'

const d: IdCardData = { school: { name: 'Bright Future Academy', address: '12 Palm Street, Lagos', phone: '0803 000 1111', email: 'office@brightfuture.test' }, name: 'Ada Obi', admissionNo: 'ADM-000001', className: 'Primary 1', gender: 'female', session: '2026/2027', photo: 'data:image/jpeg;base64,AAAA', emergency: 'Mrs Obi · 0803 123 4567' }

describe('the student ID card', () => {
  it('shows the school, the photo, the name, class, admission number, gender and session on the front', () => {
    const html = renderToStaticMarkup(<IdCardFront d={d} />)
    for (const text of ['Bright Future Academy', 'Ada Obi', 'Primary 1', 'ADM-000001', 'Female', '2026/2027', 'Student identity card']) expect(html).toContain(text)
    expect(html).toContain('src="data:image/jpeg;base64,AAAA"')
  })
  it('leaves a clear box for the photo when there is none', () => {
    const html = renderToStaticMarkup(<IdCardFront d={{ ...d, photo: null }} />)
    expect(html).not.toContain('<img'); expect(html).toContain('photo')
  })
  it('carries the return address, the emergency contact and a QR code on the back', () => {
    const html = renderToStaticMarkup(<IdCardBack d={d} />)
    for (const text of ['If found, please return to', '12 Palm Street, Lagos', '0803 000 1111', 'Mrs Obi · 0803 123 4567', 'ADM-000001', 'Principal']) expect(html).toContain(text)
    expect(html).toMatch(/<svg[^>]*role="img"[^>]*aria-label="Admission number ADM-000001"/)
    expect(renderToStaticMarkup(<IdCardBack d={{ ...d, emergency: null }} />)).toContain('See the school office')
  })
  it('draws a QR code from its text: different text, different picture', () => {
    const a = renderToStaticMarkup(<QrCode value="ADM-000001" />), b = renderToStaticMarkup(<QrCode value="ADM-000002" />)
    expect(a).toContain('<path d="M'); expect(a).not.toBe(b)
  })
})
