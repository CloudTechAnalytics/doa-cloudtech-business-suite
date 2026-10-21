import type { ModuleCode } from '@/shared/types/domain'

/** Core modules: always enabled for every business, never plan-gated (permissions still apply). */
export const CORE_MODULES: ModuleCode[] = ['dashboard', 'staff', 'settings']
