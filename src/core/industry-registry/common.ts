import type { SetupQuestion } from './types'

/** Questions every industry can reuse. */
export const TAX_QUESTION: SetupQuestion = {
  id: 'tax_rate_percent',
  label: 'Sales tax rate (%)',
  type: 'number',
  min: 0,
  max: 100,
  settingsKey: 'tax_rate_percent',
  help: 'Applied to sales by the server. Leave blank or 0 if you do not charge tax.',
}
