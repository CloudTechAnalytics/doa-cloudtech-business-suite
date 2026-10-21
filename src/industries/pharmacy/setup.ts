import { TAX_QUESTION } from '@/core/industry-registry/common'
import type { SetupQuestion } from '@/core/industry-registry/types'

export const pharmacySetupQuestions: SetupQuestion[] = [
  TAX_QUESTION,
  {
    id: 'pharmacy_type', label: 'What kind of pharmacy is this?', type: 'select',
    options: [
      { value: 'community_pharmacy', label: 'Community pharmacy' }, { value: 'medicine_store', label: 'Medicine store' }, { value: 'retail_chain', label: 'Retail pharmacy chain' },
      { value: 'hospital_pharmacy', label: 'Hospital pharmacy' }, { value: 'distributor', label: 'Pharmacy distributor' },
    ],
    help: 'A hospital pharmacy keeps pharmacy workflows only; hospital patient records are a separate module.',
  },
  { id: 'licence_number', label: 'Pharmacy licence or registration number', type: 'text', help: 'Shown on your pharmacy profile. You can add it later in Batches & Expiry settings.' },
]
