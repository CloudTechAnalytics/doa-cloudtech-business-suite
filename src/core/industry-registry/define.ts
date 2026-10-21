import type { IndustryDefinition } from './types'
import { validateIndustry } from './validate'

/** Declare an industry. Invalid definitions throw immediately (at import time, in tests and in the build). */
export function defineIndustry(definition: IndustryDefinition): IndustryDefinition {
  return validateIndustry(definition)
}
