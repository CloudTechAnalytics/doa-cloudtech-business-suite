import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { avatarUrl } from '@/core/auth/useProfile'

describe('profile pictures', () => {
  it('are looked up in the public avatars bucket, and a person with no picture has none', () => {
    expect(avatarUrl('u1/avatar-1.jpg')).toMatch(/\/storage\/v1\/object\/public\/avatars\/u1\/avatar-1\.jpg$/)
    expect(avatarUrl(null)).toBeNull()
    expect(avatarUrl('')).toBeNull()
  })

  it('can only be added, replaced or removed inside the person\'s own folder, and only as small images', () => {
    const sql = readFileSync('supabase/migrations/20261021000028_avatars.sql', 'utf8')
    for (const verb of ['insert', 'update', 'delete']) expect(sql).toMatch(new RegExp(`create policy avatars_${verb} on storage\.objects for ${verb} to authenticated`))
    expect(sql.match(/\(storage\.foldername\(name\)\)\[1\] = auth\.uid\(\)::text/g)!.length).toBeGreaterThanOrEqual(4) // insert, update (twice) and delete
    expect(sql).toContain("array['image/jpeg', 'image/png', 'image/webp']")
    expect(sql).toMatch(/file_size_limit[^;]*524288/)
    expect(sql).not.toMatch(/to anon/)
  })
})
