import type { SetupQuestion } from '@/core/industry-registry/types'

export const schoolSetupQuestions: SetupQuestion[] = [
  {
    id: 'school_type', label: 'What kind of school is this?', type: 'select',
    options: [{ value: 'nursery', label: 'Nursery' }, { value: 'primary', label: 'Primary' }, { value: 'secondary', label: 'Secondary' }, { value: 'combined', label: 'Nursery, primary and secondary' }],
    help: 'You can change the classes, terms and grading afterwards. They are set up from the standard Nigerian structure for this choice.',
  },
  { id: 'session_name', label: 'Current academic session', type: 'text', help: 'For example 2026/2027.' },
]
