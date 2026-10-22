import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { PLAN_PRICES } from '@/app/landing/PricingPage'

describe('the public pricing page', () => {
  it('shows the same monthly prices as the plans seeded in the database', () => {
    const sql = readFileSync('supabase/migrations/20261021000002_industry_and_module_engine.sql', 'utf8')
    const seeded = Object.fromEntries([...sql.matchAll(/\('(\w+)', '[^']+', (\d+), '\{/g)].map((m) => [m[1], Number(m[2])]))
    expect(PLAN_PRICES).toEqual(seeded)
  })
})
