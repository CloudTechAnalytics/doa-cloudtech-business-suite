import { describe, expect, it } from 'vitest'
import { arrange, firstName, greeting, needsSearch, roleLine } from '@/core/businesses/chooser'
import type { BusinessSummary } from '@/core/business-context/BusinessProvider'

const b = (id: string, name: string, industry: BusinessSummary['industry'] = 'retail', over: Partial<BusinessSummary> = {}): BusinessSummary => ({ id, name, industry, role: 'owner', isOwner: true, ...over })
const kind = (x: BusinessSummary) => ({ retail: 'Retail & Supermarket', farm: 'Farm Management', school: 'School', general: 'Business apps', bakery: 'Bakery & Food Production', pharmacy: 'Pharmacy & Medicine Store' })[x.industry]

describe('the greeting', () => {
  it('uses the first word of a real name, and nothing for a missing name or an email address', () => {
    expect(firstName('Adeleke John David')).toBe('Adeleke'); expect(firstName('  Ada  ')).toBe('Ada'); expect(firstName('')).toBe(''); expect(firstName(null)).toBe(''); expect(firstName(undefined)).toBe(''); expect(firstName('ada@example.com')).toBe('')
  })
  it('follows the time of day', () => {
    expect([0, 6, 11].map(greeting)).toEqual(['Good morning', 'Good morning', 'Good morning']); expect([12, 16].map(greeting)).toEqual(['Good afternoon', 'Good afternoon']); expect([17, 23].map(greeting)).toEqual(['Good evening', 'Good evening'])
  })
})

describe('which businesses show, and in what order', () => {
  const list = [b('1', 'Sunrise Bakery', 'bakery'), b('2', 'CityMart'), b('3', 'Bright School', 'school'), b('4', 'Alpha Farm', 'farm')]
  it('puts the business opened last first and the rest by name', () => {
    expect(arrange(list, '3', kind).map((x) => x.name)).toEqual(['Bright School', 'Alpha Farm', 'CityMart', 'Sunrise Bakery'])
    expect(arrange(list, null, kind).map((x) => x.name)).toEqual(['Alpha Farm', 'Bright School', 'CityMart', 'Sunrise Bakery'])
    expect(arrange(list, 'nope', kind)[0].name).toBe('Alpha Farm')
  })
  it('narrows by name or by kind of business, every word having to match, in any case', () => {
    expect(arrange(list, null, kind, 'city').map((x) => x.name)).toEqual(['CityMart']); expect(arrange(list, null, kind, 'SCHOOL').map((x) => x.name)).toEqual(['Bright School'])
    expect(arrange(list, null, kind, 'farm management').map((x) => x.name)).toEqual(['Alpha Farm']); expect(arrange(list, null, kind, 'bright farm')).toEqual([]); expect(arrange(list, null, kind, 'zzz')).toEqual([])
    expect(arrange(list, null, kind, '   ')).toHaveLength(4)
  })
  it('does not change the list it was given', () => { const copy = [...list]; arrange(list, '3', kind); expect(list).toEqual(copy) })
})

describe('what the card says about the person', () => {
  it('says whether they own it, their role, or that they are a member', () => {
    expect(roleLine({ isOwner: true, role: 'owner' })).toBe('You own this business'); expect(roleLine({ isOwner: false, role: 'inventory_officer' })).toBe('Your role: inventory officer')
    expect(roleLine({ isOwner: false, role: null })).toBe('You are a member'); expect(roleLine({})).toBe('You are a member')
  })
  it('shows a search box only when there are enough businesses to need one', () => { expect([1, 5].map(needsSearch)).toEqual([false, false]); expect([6, 30].map(needsSearch)).toEqual([true, true]) })
})
