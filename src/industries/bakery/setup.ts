import { TAX_QUESTION } from '@/core/industry-registry/common'
import type { SetupQuestion } from '@/core/industry-registry/types'

export const bakerySetupQuestions: SetupQuestion[] = [
  { id: 'sells_wholesale', label: 'Do you sell wholesale to shops or distributors?', type: 'boolean' },
  { id: 'takes_custom_orders', label: 'Do you take custom orders (cakes, events)?', type: 'boolean' },
  TAX_QUESTION,
]
