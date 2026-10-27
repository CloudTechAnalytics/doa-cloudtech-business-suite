import type { BusinessSummary } from '@/core/business-context/BusinessProvider'

/** Pure rules behind the "Your businesses" page, kept apart from the screen so they can be tested on their own. */

/** The first word of a person's name for a greeting; nothing when the name is missing or is only an email address. */
export function firstName(name: string | null | undefined): string {
  const n = (name ?? '').trim()
  if (!n || n.includes('@')) return ''
  return n.split(/\s+/)[0]
}

/** The time of day as a greeting. */
export const greeting = (hour: number) => (hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening')

/** The businesses to show: the one opened last first, then by name; narrowed by what was typed (name or kind of business). */
export function arrange(list: BusinessSummary[], lastId: string | null, kindName: (b: BusinessSummary) => string, query = ''): BusinessSummary[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  return list
    .filter((b) => words.every((w) => `${b.name} ${kindName(b)}`.toLowerCase().includes(w)))
    .sort((a, z) => Number(z.id === lastId) - Number(a.id === lastId) || a.name.localeCompare(z.name))
}

/** One line about the person's place in a business. */
export const roleLine = (b: Pick<BusinessSummary, 'isOwner' | 'role'>) =>
  b.isOwner ? 'You own this business' : b.role ? `Your role: ${b.role.replace(/_/g, ' ')}` : 'You are a member'

/** A search box is only worth showing when there are enough businesses to look through. */
export const needsSearch = (count: number) => count >= 6
