import { describe, expect, it } from 'vitest'
import { passwordProblem } from '@/core/auth/AuthPages'

describe('the password rules shown on the sign-up and reset forms', () => {
  it('accepts a long password with a lowercase letter, an uppercase letter and a digit', () => {
    expect(passwordProblem('Abcdefghi1')).toBeNull()
    expect(passwordProblem('correct Horse battery 7')).toBeNull()
  })

  it('rejects anything missing one of those', () => {
    for (const bad of ['Ab1', 'abcdefghij1', 'ABCDEFGHIJ1', 'Abcdefghijk', 'Dddddddddd', 'dddddddddd1']) expect(passwordProblem(bad), bad).not.toBeNull()
  })
})
