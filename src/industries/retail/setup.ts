import { TAX_QUESTION } from '@/core/industry-registry/common'
import type { SetupQuestion } from '@/core/industry-registry/types'

export const retailSetupQuestions: SetupQuestion[] = [
  TAX_QUESTION,
  { id: 'sells_on_credit', label: 'Do you sell to customers on credit?', type: 'boolean', help: 'You can set a credit limit per customer later.' },
]
