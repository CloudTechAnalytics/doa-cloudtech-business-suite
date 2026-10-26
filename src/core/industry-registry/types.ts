import type { LucideIcon } from 'lucide-react'
import type { ComponentType, LazyExoticComponent } from 'react'
import type { IndustryCode, ModuleCode, ModuleDefinition, SharedModuleCode } from '@/shared/types/domain'

/**
 * The industry module contract. An industry is trusted application code (part of the build) plus
 * configuration. The database only decides whether a module is enabled for a business; it never
 * supplies code. See docs/adding-an-industry.md.
 */

/** A page or widget component; industries should lazy-load these so the registry stays light. */
export type PageComponent = ComponentType | LazyExoticComponent<ComponentType>

export interface PermissionDefinition {
  /** Must start with the industry id, e.g. "farm.record". */
  code: string
  description: string
}

/** A sidebar section contributed by an industry. */
export interface NavSection {
  label: string
  modules: ModuleCode[]
}

/** Binds an industry-owned module to its page component. The path comes from the module definition. */
export interface IndustryRoute {
  module: ModuleCode
  component: PageComponent
}

export type SetupAnswerValue = string | number | boolean

export interface SetupQuestion {
  id: string
  label: string
  type: 'text' | 'number' | 'boolean' | 'select'
  options?: { value: string; label: string }[]
  required?: boolean
  min?: number
  max?: number
  help?: string
  /** Saved as this top-level business setting (read by the database) instead of under settings.setup. */
  settingsKey?: 'tax_rate_percent'
}

/** What an industry's customer tab receives. */
export interface CustomerSectionProps { businessId: string; customerId: string; customerName: string }

/** An extra tab on the customer profile (farm orders, pharmacy prescriptions, credit account). Lazy-load the component. */
export interface CustomerSection {
  id: string
  title: string
  component: ComponentType<CustomerSectionProps> | LazyExoticComponent<ComponentType<CustomerSectionProps>>
}

export interface DashboardWidget {
  id: string
  title: string
  component: PageComponent
}

/** A named task users start from the Record menu. */
export interface WorkflowEntry {
  id: string
  label: string
  module: ModuleCode
  description: string
}

export type IndustryStatus = 'active' | 'coming_soon'

export interface IndustryDefinition {
  id: IndustryCode
  name: string
  description: string
  /** Heading the business-type picker groups this industry under (e.g. "Farming & food"). */
  category: string
  /** Name of this industry's app on the public site (defaults to its first sidebar section). */
  appName?: string
  icon: LucideIcon
  /** Bump when module sets or setup questions change; the database template mirrors it. */
  version: number
  status: IndustryStatus

  /** Modules this industry owns (codes prefixed with the industry id). Empty for industries that only compose shared modules. */
  modules: ModuleDefinition[]
  /** Shared modules the industry cannot work without. */
  requiredSharedModules: SharedModuleCode[]
  /** Shared modules that may be switched on. */
  optionalSharedModules: SharedModuleCode[]
  /** Enabled when a business is created (core modules are implicit). */
  defaultModules: ModuleCode[]
  /** Compatible modules a business may opt into later. */
  optionalModules: ModuleCode[]
  /** Defaults that cannot be switched off while the business is in this industry. */
  requiredModules: ModuleCode[]

  /**
   * Runs once, right after a business of this industry is created, with the answers given while setting it up. An industry uses it to configure the
   * new business from those answers (a school builds its classes, departments and subjects for the kind of school chosen). Returns a message when it fails,
   * which is shown to the owner; the business itself is still created.
   */
  afterCreate?: (businessId: string, answers: Record<string, SetupAnswerValue>) => Promise<string | null>

  permissions: PermissionDefinition[]
  navigation: NavSection[]
  routes: IndustryRoute[]
  onboarding: {
    questions: SetupQuestion[]
    /** Extra rules beyond the generic per-question checks; return field -> message. */
    validate?: (answers: Record<string, SetupAnswerValue>) => Record<string, string>
  }
  dashboardWidgets: DashboardWidget[]
  workflows: WorkflowEntry[]
  /** Extra tabs on the customer profile; omit for none. */
  customerSections?: CustomerSection[]
}

export class IndustryDefinitionError extends Error {
  readonly industry: string
  readonly problems: string[]
  constructor(industry: string, problems: string[]) {
    super(`Invalid industry definition "${industry}":\n - ${problems.join('\n - ')}`)
    this.name = 'IndustryDefinitionError'
    this.industry = industry
    this.problems = problems
  }
}
