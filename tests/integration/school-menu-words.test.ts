import { describe, expect, it } from 'vitest'
import { getIndustry } from '@/core/industry-registry'
import { schoolSetupQuestions } from '@/industries/school/setup'
import { demoCreateBusiness, demoSignIn, demoSignOut } from '@/demo/demoStore'

const make = async (type: string) => {
  demoSignOut(); demoSignIn('owner@demo.test', 'demo1234')
  const id = demoCreateBusiness('Words ' + type, 'school')
  await getIndustry('school').afterCreate!(id, { school_type: type, session_name: '2026/2027' })
  return id
}

describe('an online school is offered at registration and talks about courses', () => {
  it('is one of the kinds of school you can pick', () => {
    const q = schoolSetupQuestions.find((x) => x.id === 'school_type')!
    expect(q.options!.map((o) => o.value)).toEqual(['nursery', 'primary', 'secondary', 'combined', 'online'])
  })

  it('renames the menu for an online school only', async () => {
    const labels = getIndustry('school').moduleLabels!
    expect(await labels(await make('online'))).toEqual({ 'school-my-classes': 'My Courses', 'school-classes': 'Courses & Units', 'school-staff': 'Instructors & Staff' })
    for (const type of ['nursery', 'primary', 'secondary', 'combined']) expect(await labels(await make(type))).toEqual({})
  })
})
