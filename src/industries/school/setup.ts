import type { SetupQuestion } from '@/core/industry-registry/types'

export const schoolSetupQuestions: SetupQuestion[] = [
  {
    id: 'school_type', label: 'What kind of school is this?', type: 'select',
    options: [{ value: 'nursery', label: 'Nursery only' }, { value: 'primary', label: 'Primary only' }, { value: 'secondary', label: 'Secondary only' }, { value: 'combined', label: 'All: nursery, primary and secondary' }],
    help: 'You can change the classes, terms and grading afterwards. Only the classes and subjects of this kind of school are set up and shown.',
  },
  { id: 'session_name', label: 'Current academic session', type: 'text', help: 'For example 2026/2027.' },
]
