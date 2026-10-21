import type { LazyExoticComponent, ComponentType } from 'react'
import type { ModuleDefinition } from '@/shared/types/domain'

/** What a shared module contributes to the platform: its definition and its page. */
export interface SharedModule {
  definition: ModuleDefinition
  page: LazyExoticComponent<ComponentType> | ComponentType
}

export interface ModuleRouteEntry {
  path: string
  code: string
  component: ComponentType | LazyExoticComponent<ComponentType>
}
