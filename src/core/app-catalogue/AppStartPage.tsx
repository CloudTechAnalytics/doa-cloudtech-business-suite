import { Check } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { SiteHeader } from '@/app/landing/SiteHeader'
import { useBusiness } from '@/core/business-context/BusinessProvider'
import { MODULES } from '@/core/module-registry/registry'
import { demoCreateBusiness } from '@/demo/demoStore'
import { Button, Card, ErrorState, TextField } from '@/shared/components'
import { isDemoMode } from '@/shared/utilities/env'
import { supabase } from '@/shared/utilities/supabase'
import { STANDALONE_APPS } from './apps'
import { clearPendingApp } from './pendingApp'
import { startWithApp } from './startWithApp'

/**
 * Where someone lands after signing in or creating an account from one app's link: a workspace for that one app, named by them. It is created with only that
 * app switched on, so they work in it alone. There is no business type to pick; the other apps are one click away in the App Store when they want them.
 */
export function AppStartPage() {
  const { appId } = useParams()
  const app = STANDALONE_APPS.find((a) => a.id === appId)
  const navigate = useNavigate()
  const { refresh, select } = useBusiness()
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  if (!app) return <Navigate to="/businesses" replace />

  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!app) return
    if (!name.trim()) return setError('Enter a name for your workspace.')
    setBusy(true); setError(null)
    let id: string
    if (isDemoMode) id = demoCreateBusiness(name.trim(), 'general')
    else {
      if (!supabase) { setBusy(false); return setError('Backend not configured.') }
      const { data, error: err } = await supabase.rpc('create_business', { p_name: name.trim(), p_industry: 'general', p_currency: 'NGN', p_timezone: 'Africa/Lagos' })
      if (err) { setBusy(false); return setError(err.message) }
      id = data as string
    }
    const only = await startWithApp(id, app.id)
    await refresh(); select(id); clearPendingApp(); setBusy(false)
    if (only) setError(only)
    navigate(`/app/${MODULES[app.home].path}`, { replace: true })
  }

  return (
    <div className="min-h-dvh bg-canvas">
      <SiteHeader />
      <div className="mx-auto max-w-xl px-4 py-12">
        <div className="text-center">
          <span className="mx-auto grid size-14 place-items-center rounded-2xl text-white" style={{ background: app.color }}><app.icon className="size-7" aria-hidden /></span>
          <h1 className="mt-4 text-3xl font-bold tracking-tight">{app.name}</h1>
          <p className="mt-1 text-ink/70">{app.tagline}</p>
        </div>
        <Card className="mt-8">
          <form onSubmit={create} noValidate className="space-y-4">
            <TextField label="Name your workspace" value={name} onChange={(e) => setName(e.target.value)} placeholder={`e.g. My ${app.name.replace('DOA ', '')}`} hint="Your records are kept here, apart from any other business you have." autoFocus />
            <ul className="space-y-1 text-sm text-ink/80">{app.benefits.map((b) => <li key={b} className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />{b}</li>)}</ul>
            {error && <ErrorState title="Could not start" message={error} />}
            <Button type="submit" className="w-full" loading={busy}>Start with {app.name.replace('DOA ', '')}</Button>
            <p className="text-center text-xs text-ink/60">You will have {app.name} only. Add other apps any time from the App Store. {app.free}</p>
          </form>
        </Card>
      </div>
    </div>
  )
}
