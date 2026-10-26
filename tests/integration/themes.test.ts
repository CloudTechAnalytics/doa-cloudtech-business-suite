import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { demoSetTheme, demoSignIn, demoSignOut, getDemoState } from '@/demo/demoStore'
import { DEFAULT_THEME, THEMES, themeByKey } from '@/core/theme/themes'

describe('colour themes', () => {
  it('are the same names the database accepts', () => {
    const sql = readFileSync('supabase/migrations/20261021000023_business_theme.sql', 'utf8')
    const accepted = [...sql.matchAll(/in \(('ocean'[^)]*)\)/g)].map((m) => m[1].split(',').map((s) => s.trim().replace(/'/g, '')))
    expect(accepted.length).toBeGreaterThan(0)
    for (const list of accepted) expect(list).toEqual(THEMES.map((t) => t.key))
  })

  it('are real colours, start on Ocean, and fall back to Ocean for anything unknown', () => {
    for (const t of THEMES) for (const c of [t.brand, t.brandDark, t.accent, t.accentSoft, t.cta, t.ctaDark, t.soft]) expect(c, t.key).toMatch(/^#[0-9a-f]{6}$/)
    expect(DEFAULT_THEME.key).toBe('ocean')
    expect(themeByKey('nonsense').key).toBe('ocean')
    expect(themeByKey(null).key).toBe('ocean')
  })

  it('can be changed in demo mode by an owner but not by a cashier, and only to a named theme', () => {
    demoSignOut(); demoSignIn('cashier@demo.test', 'demo1234')
    expect(demoSetTheme('b-retail', 'violet')).toMatch(/permission denied/)
    demoSignOut(); demoSignIn('owner@demo.test', 'demo1234')
    expect(demoSetTheme('b-retail', '#ff0000')).toMatch(/colour themes/)
    expect(demoSetTheme('b-retail', 'violet')).toBeNull()
    expect(getDemoState().businesses.find((b) => b.id === 'b-retail')!.settings?.theme).toBe('violet')
  })
})
