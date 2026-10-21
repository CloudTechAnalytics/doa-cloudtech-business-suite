import type { ModuleDefinition } from '@/shared/types/domain'
import { Card, EmptyState, PageHeader } from './index'

/** Honest placeholder for modules whose screens and data are not built yet. */
export function ModulePlaceholder({ module }: { module: ModuleDefinition }) {
  return (
    <>
      <PageHeader title={module.name} description={module.description} />
      <EmptyState title="Nothing here yet" description="This module is registered and permission-checked, but its screens are not built yet. No data is connected." />
      <Card className="mt-4 text-sm text-navy/70">
        Permission required (enforced by the backend): <code className="font-mono text-navy">{module.permission}</code>
      </Card>
    </>
  )
}
