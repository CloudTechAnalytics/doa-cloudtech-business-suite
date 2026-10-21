import { listIndustries } from '@/core/industry-registry'
import type { SetupAnswerValue } from '@/core/industry-registry/types'
import type { IndustryCode, ModuleCode } from '@/shared/types/domain'

/**
 * A visitor's choices on the "Choose your business" pages, kept in this browser so they survive creating an
 * account (and confirming an email address if the backend requires it). It holds no credentials: only
 * business types, names, setup answers and add-on choices.
 */
export interface OnboardingDraft {
  selected: IndustryCode[]
  names: Record<string, string>
  answers: Record<string, Record<string, SetupAnswerValue>>
  addons: Record<string, ModuleCode[]>
  currency: string
  tz: string
}

const KEY = 'doa.onboarding.draft'

export function saveDraft(d: OnboardingDraft): void {
  try { localStorage.setItem(KEY, JSON.stringify(d)) } catch { /* storage unavailable */ }
}

export function clearDraft(): void {
  try { localStorage.removeItem(KEY) } catch { /* storage unavailable */ }
}

/** Returns the saved draft, or null if there is none or it is not usable. Unknown or unavailable types are dropped. */
export function loadDraft(): OnboardingDraft | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const d = JSON.parse(raw) as Partial<OnboardingDraft>
    const available = new Set(listIndustries().filter((i) => i.status === 'active').map((i) => i.id))
    const selected = Array.isArray(d.selected) ? d.selected.filter((x) => available.has(x)) : []
    if (!selected.length) return null
    return {
      selected,
      names: d.names && typeof d.names === 'object' ? d.names : {},
      answers: d.answers && typeof d.answers === 'object' ? d.answers : {},
      addons: d.addons && typeof d.addons === 'object' ? d.addons : {},
      currency: typeof d.currency === 'string' ? d.currency : 'NGN',
      tz: typeof d.tz === 'string' ? d.tz : 'Africa/Lagos',
    }
  } catch {
    return null
  }
}
