import type { SetupQuestion } from '@/core/industry-registry/types'

export const schoolSetupQuestions: SetupQuestion[] = [
  {
    id: 'school_type', label: 'What kind of school is this?', type: 'select',
    options: [{ value: 'nursery', label: 'Nursery only' }, { value: 'primary', label: 'Primary only' }, { value: 'secondary', label: 'Secondary only' }, { value: 'combined', label: 'All: nursery, primary and secondary' }, { value: 'online', label: 'Online school: courses you offer' }],
    help: 'You can change the classes, terms and grading afterwards. Only the classes and subjects of this kind of school are set up and shown. An online school starts with no courses: you add the ones you offer.',
  },
  { id: 'session_name', label: 'Current academic session (or cohort, for an online school)', type: 'text', help: 'For example 2026/2027. An online school runs in cohorts instead of terms: name the first one, such as "January 2027 intake".' },
]
