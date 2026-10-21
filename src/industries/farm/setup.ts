import { TAX_QUESTION } from '@/core/industry-registry/common'
import type { SetupAnswerValue, SetupQuestion } from '@/core/industry-registry/types'

export const farmSetupQuestions: SetupQuestion[] = [
  { id: 'has_poultry', label: 'Do you keep poultry?', type: 'boolean' },
  { id: 'has_fish', label: 'Do you run fish ponds or tanks?', type: 'boolean' },
  { id: 'has_crops', label: 'Do you grow crops?', type: 'boolean' },
  TAX_QUESTION,
]

/** A farm must run at least one kind of production. */
export function validateFarmSetup(answers: Record<string, SetupAnswerValue>): Record<string, string> {
  const any = answers.has_poultry === true || answers.has_fish === true || answers.has_crops === true
  return any ? {} : { has_poultry: 'Select at least one type of production.' }
}
