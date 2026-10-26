import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? sources(join(dir, e.name)) : /\.(ts|tsx)$/.test(e.name) ? [join(dir, e.name)] : []))
}

describe('reading people alongside business members', () => {
  it('always says which of the two links to profiles to follow', () => {
    // business_members points at profiles twice (the member and whoever invited them), so an unqualified embed makes the database answer "more than one relationship was found".
    const bad = sources('src').filter((f) => /from\('business_members'\)\.select\([^)]*\bprofiles\(/.test(readFileSync(f, 'utf8')))
    expect(bad).toEqual([])
  })
})
