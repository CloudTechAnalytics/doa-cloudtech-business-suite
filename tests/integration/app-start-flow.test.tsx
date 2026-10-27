import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { STANDALONE_APPS, startPath } from '@/core/app-catalogue/apps'
import { afterAuthPath, clearPendingApp, pendingApp, rememberApp } from '@/core/app-catalogue/pendingApp'
import { SignInPage, SignUpPage } from '@/core/auth/AuthPages'
import { groupByCategory } from '@/core/businesses/selection'
import { listIndustries } from '@/core/industry-registry'

const store = new Map<string, string>()
const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
beforeEach(() => {
  store.clear()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) },
  })
})
afterEach(() => { if (original) Object.defineProperty(globalThis, 'localStorage', original) })

describe('an app link goes to sign-in, then to that one app', () => {
  it('points each app at the sign-in page for that app', () => {
    expect(STANDALONE_APPS.map(startPath)).toEqual(['/sign-in?app=crm', '/sign-in?app=pos', '/sign-in?app=inventory', '/sign-in?app=invoices', '/sign-in?app=expenses', '/sign-in?app=finance', '/sign-in?app=calendar'])
  })

  it('remembers the app through sign-in or sign-up and sends the person to its start page afterwards', () => {
    expect(afterAuthPath()).toBe('/businesses')
    rememberApp('pos'); expect(pendingApp()?.id).toBe('pos'); expect(afterAuthPath()).toBe('/start/pos')
    clearPendingApp(); expect(afterAuthPath()).toBe('/businesses')
  })

  it('ignores an app that does not exist', () => {
    rememberApp('nope'); rememberApp(null); expect(pendingApp()).toBeNull(); expect(afterAuthPath()).toBe('/businesses')
  })

  const page = (el: React.ReactElement, url: string) => renderToStaticMarkup(
    <MemoryRouter initialEntries={[url]}>{el}</MemoryRouter>)

  it('shows the sign-in page for the app, with a way to create an account for the same app', () => {
    const html = page(<SignInPage />, '/sign-in?app=crm')
    expect(html).toContain('Sign in to DOA CRM'); expect(html).toContain('/sign-up?app=crm')
    expect(pendingApp()?.id).toBe('crm')
  })

  it('shows the sign-up page for the app, with a way back to sign in', () => {
    const html = page(<SignUpPage />, '/sign-up?app=invoices')
    expect(html).toContain('Create your account for DOA Invoices'); expect(html).toContain('/sign-in?app=invoices')
  })

  it('leaves the ordinary sign-in page alone', () => {
    const html = page(<SignInPage />, '/sign-in')
    expect(html).toContain('Sign in'); expect(html).not.toContain('Sign in to DOA')
  })
})

describe('the business picker', () => {
  it('is for industries only: "Business apps" is reached through the apps, not offered as a business type', () => {
    const shown = listIndustries().filter((d) => d.id !== 'general')
    expect(groupByCategory(shown).map((g) => g.category)).toEqual(['Shops & trade', 'Farming & food', 'Education'])
    expect(shown.map((d) => d.id)).not.toContain('general')
  })
})
