import type { LucideIcon } from 'lucide-react'

// Typed domain interfaces mirroring the PRD schema (section 8).

export type IndustryCode = 'retail' | 'farm' | 'bakery' | 'pharmacy' | 'school' | 'general'

/** Modules owned by the platform. Industry modules add their own codes (prefixed with the industry id). */
export const SHARED_MODULE_CODES = [
  'dashboard', 'inventory', 'sales', 'purchases', 'suppliers', 'customers', 'expenses', 'reports', 'staff', 'settings',
] as const
export type SharedModuleCode = (typeof SHARED_MODULE_CODES)[number]
/** Shared codes autocomplete; industry-owned codes are validated at registry build time and by tests. */
export type ModuleCode = SharedModuleCode | (string & Record<never, never>)

export type RoleName =
  | 'owner'
  | 'business_admin'
  | 'manager'
  | 'accountant'
  | 'cashier'
  | 'inventory_officer'
  | 'operations_staff'
  | 'pharmacist'
  | 'pharmacy_technician'
  | 'principal'
  | 'teacher'
  | 'bursar'
  | 'admissions_officer'
  | 'parent'
  | 'viewer'

export type MembershipStatus = 'invited' | 'active' | 'suspended' | 'revoked'
export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'canceled' | 'expired'

export interface Profile {
  id: string
  displayName: string
  phone?: string
}

export interface Business {
  id: string
  ownerUserId: string
  name: string
  primaryIndustryCode: IndustryCode
  countryCode: string
  defaultCurrency: string
  timezone: string
  status: 'active' | 'archived'
}

export interface BusinessMembership {
  id: string
  businessId: string
  userId: string
  roleId: string
  status: MembershipStatus
}

export interface ModuleDefinition {
  code: ModuleCode
  name: string
  description: string
  /** Route path, relative to /app */
  path: string
  /** Permission required to see the module; enforced by the backend as well. */
  permission: string
  icon: LucideIcon
  /** Sidebar section the module appears in. */
  navGroup: string
  /** 'platform' for shared modules, otherwise the industry that owns it. */
  owner: 'platform' | IndustryCode
  /** Shown on the public site and in menus: 'preview' = usable but unfinished, 'soon' = registered, screens not built. */
  maturity?: 'preview' | 'soon'
  /** Optional entry in the Record menu (opens the module, optionally with a query string such as "tab=Receive"). */
  quickAction?: { label: string; query?: string }
}

export interface IndustryTemplate {
  code: IndustryCode
  name: string
  description: string
  available: boolean
  /** Default modules enabled when a business is created (core modules are implicit). */
  modules: ModuleCode[]
  /** Compatible modules a business may opt into. */
  optionalModules: ModuleCode[]
  /** Defaults that cannot be disabled while the business is in this industry. */
  requiredModules: ModuleCode[]
}

export type PlanCode = 'starter' | 'basic' | 'growth' | 'business'
