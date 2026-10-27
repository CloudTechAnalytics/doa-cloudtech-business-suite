import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ConfirmSwitch } from '@/core/app-catalogue/ConfirmSwitch'
import { SWITCH_OFF_EFFECTS, STANDALONE_APPS } from '@/core/app-catalogue/apps'

const render = (id: string, on: boolean, extra: Partial<Parameters<typeof ConfirmSwitch>[0]> = {}) =>
  renderToStaticMarkup(<ConfirmSwitch app={STANDALONE_APPS.find((a) => a.id === id)!} on={on} businessId="b" businessName="Acme Studio" busy={false} error={null} onCancel={() => {}} onConfirm={() => {}} {...extra} />)

describe('switching an app on or off asks first', () => {
  it('says what happens when each app is switched off, for every app', () => {
    expect(Object.keys(SWITCH_OFF_EFFECTS).sort()).toEqual(STANDALONE_APPS.map((a) => a.id).sort())
    for (const a of STANDALONE_APPS) expect(SWITCH_OFF_EFFECTS[a.id].length, a.id).toBeGreaterThanOrEqual(2)
  })

  it('off: names the app and the business, lists what stops and what is kept, and offers a way back', () => {
    const html = render('invoices', false)
    for (const t of ['Switch off DOA Invoices?', 'Acme Studio', 'Nobody can create invoices or record payments', 'Nothing is deleted', 'Cancel', 'Yes, switch off']) expect(html).toContain(t)
  })

  it('off: says the rest of the business uses it (what still shows in Finance)', () => {
    expect(render('invoices', false)).toContain('still show in Finance as money owed')
    expect(render('pos', false)).toContain('still count in Finance')
  })

  it('off: tells people when part of the app stays on because another app needs it', () => {
    expect(render('pos', false, { keepsOn: ['inventory'] })).toContain('stays on because another app you use needs it')
    expect(render('pos', false)).not.toContain('stays on because')
  })

  it('on: says what it adds, that everyone with access will see it, and that nothing is deleted if it is switched off', () => {
    const html = render('crm', true)
    for (const t of ['Switch on DOA CRM?', 'Everyone in Acme Studio who has access', 'nothing is deleted', 'Yes, switch on']) expect(html).toContain(t)
  })

  it('on: warns that POS also switches on its products list', () => {
    expect(render('pos', true)).toContain('Inventory will show as on too')
    expect(render('crm', true)).not.toContain('Inventory will show')
  })

  it('shows an error from the server and keeps the dialog open', () => {
    expect(render('crm', false, { error: 'permission denied' })).toContain('permission denied')
  })
})
