import type { IndustryDefinition, SetupAnswerValue } from './types'

export interface BusinessSettingsPatch {
  tax_rate_percent?: number
  setup?: Record<string, string | number | boolean>
}

/**
 * Turns onboarding answers into the business settings the database accepts: questions with a
 * `settingsKey` go to that top-level key, everything else is stored flat under `setup`.
 * Blank answers are dropped. The database validates the result again (validate_business_settings).
 */
export function answersToSettings(d: IndustryDefinition, answers: Record<string, SetupAnswerValue>): BusinessSettingsPatch {
  const out: BusinessSettingsPatch = {}
  const setup: Record<string, string | number | boolean> = {}
  for (const q of d.onboarding.questions) {
    const v = answers[q.id]
    if (v === undefined || v === '') continue
    if (q.settingsKey === 'tax_rate_percent') out.tax_rate_percent = Number(v)
    else setup[q.id] = q.type === 'number' ? Number(v) : v
  }
  if (Object.keys(setup).length) out.setup = setup
  return out
}
