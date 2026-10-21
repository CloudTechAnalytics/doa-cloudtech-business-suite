import { EmptyState, PageHeader } from '@/shared/components'

export function PlatformAdminPage() {
  return (
    <>
      <PageHeader title="Platform administration" description="Industry definitions, plans and support tools, separate from business roles." />
      <EmptyState title="Not available yet" description="Platform administration needs its own authorisation model and is planned for a later stage." />
    </>
  )
}
