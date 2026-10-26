import { LockKeyhole } from 'lucide-react'
import { useState } from 'react'
import { useAuth } from '@/core/auth/AuthProvider'
import { useBusiness } from '@/core/business-context/BusinessProvider'
import type { BlockedAccess } from '@/core/business-context/BusinessProvider'
import { Button } from '@/shared/components'
import { BrandLockup } from './Brand'

/** What someone sees when the owner has suspended or removed their access: the workspace is locked, and they are told why and who to ask. */
export function AccessSuspended({ blocked }: { blocked: BlockedAccess[] }) {
  const { signOut } = useAuth()
  const { refresh } = useBusiness()
  const [checking, setChecking] = useState(false)
  const first = blocked[0]
  const removed = first?.status === 'revoked'
  return (
    <main className="grid min-h-dvh place-items-center bg-surface px-4">
      <div role="alert" className="w-full max-w-md rounded-xl bg-white p-8 text-center shadow-card">
        <div className="flex justify-center"><BrandLockup /></div>
        <span className="mx-auto mt-6 grid size-14 place-items-center rounded-full bg-danger-soft text-danger"><LockKeyhole className="size-7" aria-hidden /></span>
        <h1 className="mt-4 text-xl font-bold">{removed ? 'Your access was removed' : 'Your access is suspended'}</h1>
        <p className="mt-2 text-sm text-ink/70">
          {blocked.length > 1 ? 'Your access to these businesses is currently switched off:' : <>Your access to <b>{first?.name}</b> {removed ? 'has been removed' : 'has been suspended'} by the owner.</>}
        </p>
        {blocked.length > 1 && <ul className="mt-2 text-sm font-medium">{blocked.map((b) => <li key={b.id}>{b.name} <span className="text-ink/60">({b.status === 'revoked' ? 'removed' : 'suspended'})</span></li>)}</ul>}
        <p className="mt-3 text-sm text-ink/70">Nothing can be opened or changed until it is restored. Please contact the owner or an administrator.</p>
        <div className="mt-6 flex justify-center gap-2">
          <Button variant="secondary" loading={checking} onClick={() => { setChecking(true); void refresh().finally(() => setChecking(false)) }}>Check again</Button>
          <Button onClick={signOut}>Sign out</Button>
        </div>
      </div>
    </main>
  )
}
